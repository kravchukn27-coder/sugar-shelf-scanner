import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "redis";

export type GuardScope = "preflight" | "analyze" | "recovery_label" | "recovery_barcode" | "access_restore" | "access_redeem";
export type GeminiOperation = "preflight" | "analyze" | "nutrition_label";

type Limit = { limit: number; windowMs: number };
type ScopePolicy = { installation: Limit; ip: Limit };

const POLICIES: Record<GuardScope, ScopePolicy> = {
  preflight: { installation: { limit: 90, windowMs: 60_000 }, ip: { limit: 180, windowMs: 60_000 } },
  analyze: { installation: { limit: 10, windowMs: 60_000 }, ip: { limit: 30, windowMs: 60_000 } },
  recovery_label: { installation: { limit: 3, windowMs: 600_000 }, ip: { limit: 10, windowMs: 600_000 } },
  recovery_barcode: { installation: { limit: 20, windowMs: 600_000 }, ip: { limit: 60, windowMs: 600_000 } },
  access_restore: { installation: { limit: 5, windowMs: 900_000 }, ip: { limit: 15, windowMs: 900_000 } },
  access_redeem: { installation: { limit: 5, windowMs: 900_000 }, ip: { limit: 15, windowMs: 900_000 } },
};

const WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

const ACQUIRE_SCRIPT = `
local total = tonumber(redis.call('GET', KEYS[1]) or '0')
local operation = tonumber(redis.call('GET', KEYS[2]) or '0')
if total >= tonumber(ARGV[1]) or operation >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return 1
`;

const RELEASE_SCRIPT = `
for i = 1, #KEYS do
  local remaining = redis.call('DECR', KEYS[i])
  if remaining <= 0 then redis.call('DEL', KEYS[i]) end
end
return 1
`;

const RESERVE_REQUEST_SCRIPT = `
local minute = tonumber(redis.call('GET', KEYS[1]) or '0')
local day = tonumber(redis.call('GET', KEYS[2]) or '0')
if minute >= tonumber(ARGV[1]) or day >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 1
`;

type RedisEval = { eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> };
type LiveRedisClient = RedisEval & { isReady: boolean; on(event: "error", listener: () => void): unknown; connect(): Promise<unknown>; close(): Promise<void> };
type RedisHolder = { client?: LiveRedisClient; connecting?: Promise<LiveRedisClient>; url?: string };
const redisHolder = globalThis as typeof globalThis & { __sugarRedisGuard?: RedisHolder };
const developmentSecret = randomUUID();

export class RedisGuardUnavailableError extends Error {
  constructor() { super("Shared rate limiter is unavailable."); this.name = "RedisGuardUnavailableError"; }
}

function production(environment: NodeJS.ProcessEnv) { return environment.NODE_ENV === "production"; }

async function redisFor(environment: NodeJS.ProcessEnv = process.env): Promise<LiveRedisClient> {
  const url = environment.REDIS_URL;
  // Tests and local mock work intentionally retain the existing in-process
  // guard. Production Gemini traffic must never silently fall back to it.
  if (!url) throw new RedisGuardUnavailableError();
  const holder = redisHolder.__sugarRedisGuard ??= {};
  if (holder.client?.isReady && holder.url === url) return holder.client;
  if (!holder.connecting || holder.url !== url) {
    const client = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 1_000, reconnectStrategy: false } }) as unknown as LiveRedisClient;
    client.on("error", () => undefined);
    holder.url = url;
    holder.connecting = client.connect().then(() => {
      holder.client = client;
      holder.connecting = undefined;
      return client;
    }).catch((error: unknown) => {
      holder.connecting = undefined;
      void client.close().catch(() => undefined);
      throw error;
    });
  }
  try { return await holder.connecting; } catch { throw new RedisGuardUnavailableError(); }
}

function keyDigest(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    ?? request.headers.get("x-real-ip")?.trim()
    ?? "unknown-client";
}

function installation(request: Request) {
  const value = request.headers.get("x-sugar-installation");
  return value && /^[a-f0-9]{32}$/i.test(value) ? value.toLowerCase() : null;
}

function rateSecret(environment: NodeJS.ProcessEnv) {
  const value = environment.RATE_LIMIT_SECRET;
  if (value && value.length >= 16) return value;
  if (!production(environment)) return developmentSecret;
  throw new RedisGuardUnavailableError();
}

async function increment(redis: RedisEval, key: string, windowMs: number) {
  const result = await redis.eval(WINDOW_SCRIPT, { keys: [key], arguments: [String(windowMs)] });
  if (!Array.isArray(result) || typeof result[0] !== "number" || typeof result[1] !== "number") throw new RedisGuardUnavailableError();
  return { count: result[0], ttlMs: result[1] };
}

export type GuardResult = { allowed: boolean; retryAfterSeconds: number };

/** Shared, HMAC-keyed fixed windows. Both dimensions must allow the request. */
export async function checkSharedRateLimit(request: Request, scope: GuardScope, environment: NodeJS.ProcessEnv = process.env, redis?: RedisEval): Promise<GuardResult> {
  const secret = rateSecret(environment);
  const client = redis ?? await redisFor(environment);
  const policy = POLICIES[scope];
  const dimensions: Array<["ip" | "installation", string, Limit]> = [["ip", requestIp(request), policy.ip]];
  const browserInstallation = installation(request);
  if (browserInstallation) dimensions.push(["installation", browserInstallation, policy.installation]);
  try {
    const results = await Promise.all(dimensions.map(async ([dimension, value, limit]) => {
      const item = await increment(client, `sugar:v1:rate:${scope}:${dimension}:${keyDigest(value, secret)}`, limit.windowMs);
      return { ...item, limit };
    }));
    const denied = results.filter((result) => result.count > result.limit.limit);
    return denied.length === 0
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds: Math.max(...denied.map((result) => Math.max(1, Math.ceil(result.ttlMs / 1_000)))) };
  } catch (error) {
    if (error instanceof RedisGuardUnavailableError) throw error;
    throw new RedisGuardUnavailableError();
  }
}

function positiveInteger(name: string, environment: NodeJS.ProcessEnv) {
  const value = environment[name];
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) throw new RedisGuardUnavailableError();
  return Number(value);
}

const operationEnv: Record<GeminiOperation, string> = {
  preflight: "GEMINI_PREFLIGHT_CONCURRENCY_LIMIT",
  analyze: "GEMINI_ANALYZE_CONCURRENCY_LIMIT",
  nutrition_label: "GEMINI_NUTRITION_LABEL_CONCURRENCY_LIMIT",
};

/** A short Redis lease bounds actual provider calls across every API replica. */
export async function acquireGeminiPermit(operation: GeminiOperation, environment: NodeJS.ProcessEnv = process.env, redis?: RedisEval): Promise<() => Promise<void>> {
  if (!environment.REDIS_URL && !production(environment)) return async () => undefined;
  const client = redis ?? await redisFor(environment);
  const globalLimit = positiveInteger("GEMINI_GLOBAL_CONCURRENCY_LIMIT", environment);
  const operationLimit = positiveInteger(operationEnv[operation], environment);
  const leaseMs = 35_000;
  const keys = ["sugar:v1:gemini:inflight", `sugar:v1:gemini:inflight:${operation}`];
  try {
    const acquired = await client.eval(ACQUIRE_SCRIPT, { keys, arguments: [String(globalLimit), String(operationLimit), String(leaseMs)] });
    if (acquired !== 1) throw new RedisGuardUnavailableError();
  } catch (error) {
    if (error instanceof RedisGuardUnavailableError) throw error;
    throw new RedisGuardUnavailableError();
  }
  return async () => {
    try { await client.eval(RELEASE_SCRIPT, { keys, arguments: [] }); } catch { /* lease expiry is the safety net */ }
  };
}

/** Counts provider invocations (not browser requests), including hedges/retries. */
export async function reserveGeminiRequest(environment: NodeJS.ProcessEnv = process.env, redis?: RedisEval): Promise<void> {
  if (!environment.REDIS_URL && !production(environment)) return;
  const client = redis ?? await redisFor(environment);
  const minuteLimit = positiveInteger("GEMINI_REQUESTS_PER_MINUTE_LIMIT", environment);
  const dayLimit = positiveInteger("GEMINI_REQUESTS_PER_DAY_LIMIT", environment);
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const pacificDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try {
    const reserved = await client.eval(RESERVE_REQUEST_SCRIPT, {
      keys: [`sugar:v1:gemini:requests:minute:${minuteBucket}`, `sugar:v1:gemini:requests:day:${pacificDay}`],
      arguments: [String(minuteLimit), String(dayLimit), "120000", "172800000"],
    });
    if (reserved !== 1) throw new RedisGuardUnavailableError();
  } catch (error) {
    if (error instanceof RedisGuardUnavailableError) throw error;
    throw new RedisGuardUnavailableError();
  }
}

/** Production routes use Redis. Tests/local mock retain the legacy process guard only outside production. */
export function requiresRedisGuard(environment: NodeJS.ProcessEnv = process.env) {
  return production(environment);
}

export const RATE_LIMIT_POLICIES = POLICIES;
