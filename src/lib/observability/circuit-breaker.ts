import { createClient } from "redis";

/**
 * Circuit breaker for Gemini model selection.
 *
 * This module decides, per operation, whether a request should use the
 * primary model or fail over to the fallback model, based on a rolling
 * window of recent outcomes stored in Redis (so the decision is consistent
 * across every API replica).
 *
 * This is an optimization layer only. Every Redis interaction is wrapped so
 * that ANY failure (connection, timeout, malformed reply) results in
 * silently using the primary model / reporting "closed" -- never a thrown
 * error, never added latency beyond a best-effort Redis round trip.
 *
 * Note: every `.eval(...)` call below invokes node-redis's Lua script
 * runner (the same "redis.call('EVAL', ...)" wrapper used throughout
 * redis-guard.ts), not JavaScript's global eval(). No untrusted or
 * dynamically-assembled code is ever evaluated -- the scripts are fixed
 * string constants defined in this file.
 */

export type BreakerOperation = "preflight" | "analyze";

export type ModelSelection = { model: string; isPrimary: boolean; isProbe: boolean };

export type BreakerState = "closed" | "open" | "probing";

export type BreakerStatus = {
  state: BreakerState;
  sinceMs: number | null;
  currentModel: string | null;
};

/** Minimal shape this module needs from a Redis client. Matches the DI pattern in redis-guard.ts. */
export type RedisEval = { eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> };

const FALLBACK_RING_SIZE = 5;
const PROBE_INTERVAL_CAP_MS = 30 * 60 * 1000;
const PROBE_INTERVAL_FLOOR_MS = 10_000;
// A probe's lock must outlive the request it gates, or a second probe can
// acquire the slot while the first is still in flight (the lock would
// expire mid-request, since the default probe interval is shorter than
// analyze's worst-case duration). Defaults are sized generously above each
// operation's worst-case timeout (preflight 5s; analyze 25s + one 8s retry).
// Env-overridable (like every other tunable here) so tests can use a floor
// far below production reality without waiting out a real 35s timer.
const PROBE_LOCK_FLOOR_ENV: Record<BreakerOperation, string> = {
  preflight: "GEMINI_BREAKER_PROBE_LOCK_FLOOR_MS_PREFLIGHT",
  analyze: "GEMINI_BREAKER_PROBE_LOCK_FLOOR_MS_ANALYZE",
};
const PROBE_LOCK_FLOOR_DEFAULT: Record<BreakerOperation, number> = { preflight: 6_000, analyze: 35_000 };

// ---------------------------------------------------------------------------
// Lua scripts. Each one is a single atomic round trip so replica races (two
// requests deciding at once, a probe racing a normal request) can't corrupt
// state. Distinguished in tests purely by keys/arguments shape, not identity.
// ---------------------------------------------------------------------------

/**
 * Decide primary vs fallback for one request.
 * KEYS[1] state hash, KEYS[2] primary ring (list), KEYS[3] probe lock
 * ARGV: now, minSamples, failureThreshold, cooldownMs, minTransitionIntervalMs,
 *       baseProbeIntervalMs, primaryModel, fallbackModel, probeLockFloorMs
 * Returns "primary" | "primary_probe" | "fallback"
 */
const SELECT_SCRIPT = `
local now = tonumber(ARGV[1])
redis.call('HSET', KEYS[1], 'primaryModel', ARGV[7], 'fallbackModel', ARGV[8])
local state = redis.call('HGET', KEYS[1], 'state')

if state ~= 'open' then
  local minSamples = tonumber(ARGV[2])
  local len = redis.call('LLEN', KEYS[2])
  if len >= minSamples then
    local entries = redis.call('LRANGE', KEYS[2], 0, len - 1)
    local failures = 0
    for i = 1, #entries do
      if entries[i] == '0' then failures = failures + 1 end
    end
    local rate = failures / len
    if rate >= tonumber(ARGV[3]) then
      local lastTransitionRaw = redis.call('HGET', KEYS[1], 'lastTransitionAtMs')
      local lastTransition = lastTransitionRaw and tonumber(lastTransitionRaw) or nil
      if (not lastTransition) or (now - lastTransition >= tonumber(ARGV[5])) then
        redis.call('HSET', KEYS[1], 'state', 'open', 'openedAtMs', now, 'lastTransitionAtMs', now,
          'probeIntervalMs', ARGV[6], 'recoverStreak', 0, 'fastPath', 0)
        return 'fallback'
      end
    end
  end
  return 'primary'
end

local openedAtMsRaw = redis.call('HGET', KEYS[1], 'openedAtMs')
local openedAtMs = openedAtMsRaw and tonumber(openedAtMsRaw) or nil
local cooldownMs = tonumber(ARGV[4])
if (not openedAtMs) or (now - openedAtMs < cooldownMs) then
  return 'fallback'
end

local intervalRaw = redis.call('HGET', KEYS[1], 'probeIntervalMs')
local interval = intervalRaw and tonumber(intervalRaw) or tonumber(ARGV[6])
local floor = tonumber(ARGV[9])
local ttl = interval
if ttl < floor then ttl = floor end
local acquired = redis.call('SET', KEYS[3], '1', 'NX', 'PX', ttl)
if acquired then
  return 'primary_probe'
end
return 'fallback'
`;

/**
 * Record an outcome for a request that used the PRIMARY model (either a
 * normal closed-state request, or a probe while open).
 * KEYS[1] state hash, KEYS[2] primary ring, KEYS[3] probe lock, KEYS[4] fallback ring
 * ARGV: now, isSuccess('1'/'0'), minSamples (primary ring cap), recoverStreakThreshold,
 *       minTransitionIntervalMs, probeIntervalCapMs, baseProbeIntervalMs, isProbe('1'/'0'),
 *       probeLockFloorMs
 */
const RECORD_PRIMARY_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'open' then
  redis.call('LPUSH', KEYS[2], ARGV[2])
  redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[3]) - 1)
  return 'recorded_closed'
end

-- A primary result that lands here without having actually been the probe
-- (an in-flight request that started before this breaker tripped, or a
-- transition raced with a request already underway) says nothing about
-- whether primary has recovered -- it must not touch recoverStreak or the
-- backoff interval, mirroring how RECORD_FALLBACK_SCRIPT ignores writes
-- once no longer open.
if ARGV[8] ~= '1' then
  return 'ignored'
end

local now = tonumber(ARGV[1])
local lastTransitionRaw = redis.call('HGET', KEYS[1], 'lastTransitionAtMs')
local lastTransition = lastTransitionRaw and tonumber(lastTransitionRaw) or nil

if ARGV[2] == '1' then
  local streak = redis.call('HINCRBY', KEYS[1], 'recoverStreak', 1)
  local fastPath = redis.call('HGET', KEYS[1], 'fastPath')
  local bar = tonumber(ARGV[4])
  if fastPath == '1' then bar = 1 end
  if streak >= bar then
    if (not lastTransition) or (now - lastTransition >= tonumber(ARGV[5])) then
      redis.call('HSET', KEYS[1], 'state', 'closed', 'lastTransitionAtMs', now, 'recoverStreak', 0, 'fastPath', 0)
      redis.call('DEL', KEYS[2])
      redis.call('DEL', KEYS[4])
      redis.call('DEL', KEYS[3])
      return 'closed'
    end
  end
  return 'probe_success'
else
  redis.call('HSET', KEYS[1], 'recoverStreak', 0)
  local currentRaw = redis.call('HGET', KEYS[1], 'probeIntervalMs')
  local current = currentRaw and tonumber(currentRaw) or tonumber(ARGV[7])
  local cap = tonumber(ARGV[6])
  local next = current * 2
  if next > cap then next = cap end
  redis.call('HSET', KEYS[1], 'probeIntervalMs', next)
  -- Re-arm the lock to the freshly-doubled interval right now, rather than
  -- leaving whatever's left of the failed probe's (shorter, pre-doubling)
  -- lock to expire on its own -- otherwise the next probe can arrive after
  -- only the old interval's remaining time, undershooting the backoff.
  local ttl = next
  local floor = tonumber(ARGV[9])
  if ttl < floor then ttl = floor end
  redis.call('SET', KEYS[3], '1', 'PX', ttl)
  return 'probe_failed'
end
`;

/**
 * Record an outcome for a request that used the FALLBACK model while open.
 * KEYS[1] state hash, KEYS[2] fallback ring, KEYS[3] probe lock
 * ARGV: isSuccess('1'/'0'), fallbackRingSize, failureThreshold, floorProbeIntervalMs
 */
const RECORD_FALLBACK_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'open' then
  return 'ignored'
end
redis.call('LPUSH', KEYS[2], ARGV[1])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[2]) - 1)
local len = redis.call('LLEN', KEYS[2])
if len >= tonumber(ARGV[2]) then
  local entries = redis.call('LRANGE', KEYS[2], 0, len - 1)
  local failures = 0
  for i = 1, #entries do
    if entries[i] == '0' then failures = failures + 1 end
  end
  local rate = failures / len
  if rate >= tonumber(ARGV[3]) then
    redis.call('HSET', KEYS[1], 'probeIntervalMs', ARGV[4], 'fastPath', 1)
    redis.call('DEL', KEYS[3])
    return 'degraded'
  end
end
return 'recorded'
`;

/** KEYS[1] state hash. Returns [state, openedAtMs, lastTransitionAtMs, primaryModel, fallbackModel]. */
const STATUS_SCRIPT = `
return redis.call('HMGET', KEYS[1], 'state', 'openedAtMs', 'lastTransitionAtMs', 'primaryModel', 'fallbackModel')
`;

// ---------------------------------------------------------------------------
// Redis client (own cached connection, separate from redis-guard.ts's).
// ---------------------------------------------------------------------------

type LiveRedisClient = RedisEval & {
  isReady: boolean;
  on(event: "error", listener: () => void): unknown;
  connect(): Promise<unknown>;
  close(): Promise<void>;
};
type RedisHolder = { client?: LiveRedisClient; connecting?: Promise<LiveRedisClient>; url?: string };
const redisHolder = globalThis as typeof globalThis & { __sugarBreakerRedis?: RedisHolder };

async function connectRedis(environment: NodeJS.ProcessEnv): Promise<RedisEval | undefined> {
  const url = environment.REDIS_URL;
  if (!url) return undefined;
  try {
    const holder = (redisHolder.__sugarBreakerRedis ??= {});
    if (holder.client?.isReady && holder.url === url) return holder.client;
    if (!holder.connecting || holder.url !== url) {
      const client = createClient({
        url,
        disableOfflineQueue: true,
        socket: { connectTimeout: 1_000, reconnectStrategy: false },
      }) as unknown as LiveRedisClient;
      client.on("error", () => undefined);
      holder.url = url;
      holder.connecting = client
        .connect()
        .then(() => {
          holder.client = client;
          holder.connecting = undefined;
          return client;
        })
        .catch((error: unknown) => {
          holder.connecting = undefined;
          void client.close().catch(() => undefined);
          throw error;
        });
    }
    return await holder.connecting;
  } catch {
    return undefined;
  }
}

async function resolveRedis(environment: NodeJS.ProcessEnv, redis?: RedisEval): Promise<RedisEval | undefined> {
  if (redis) return redis;
  try {
    return await connectRedis(environment);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MIN_SAMPLES_ENV: Record<BreakerOperation, string> = {
  preflight: "GEMINI_BREAKER_MIN_SAMPLES_PREFLIGHT",
  analyze: "GEMINI_BREAKER_MIN_SAMPLES_ANALYZE",
};
const MIN_SAMPLES_DEFAULT: Record<BreakerOperation, number> = { preflight: 8, analyze: 5 };

function envPositiveInt(name: string, fallback: number, environment: NodeJS.ProcessEnv): number {
  const raw = environment[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFraction(name: string, fallback: number, environment: NodeJS.ProcessEnv): number {
  const raw = environment[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function breakerConfig(environment: NodeJS.ProcessEnv) {
  return {
    minSamples: (operation: BreakerOperation) =>
      envPositiveInt(MIN_SAMPLES_ENV[operation], MIN_SAMPLES_DEFAULT[operation], environment),
    failureThreshold: envFraction("GEMINI_BREAKER_FAILURE_THRESHOLD", 0.4, environment),
    cooldownMs: envPositiveInt("GEMINI_BREAKER_COOLDOWN_MS", 120_000, environment),
    probeIntervalMs: envPositiveInt("GEMINI_BREAKER_PROBE_INTERVAL_MS", 30_000, environment),
    recoverStreak: envPositiveInt("GEMINI_BREAKER_RECOVER_STREAK", 3, environment),
    minTransitionIntervalMs: envPositiveInt("GEMINI_BREAKER_MIN_TRANSITION_INTERVAL_MS", 30_000, environment),
    probeLockFloorMs: (operation: BreakerOperation) =>
      envPositiveInt(PROBE_LOCK_FLOOR_ENV[operation], PROBE_LOCK_FLOOR_DEFAULT[operation], environment),
  };
}

function breakerKeys(operation: BreakerOperation) {
  const prefix = `sugar:v1:breaker:${operation}`;
  return {
    state: `${prefix}:state`,
    primaryRing: `${prefix}:primary:ring`,
    fallbackRing: `${prefix}:fallback:ring`,
    probeLock: `${prefix}:probe:lock`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decide which model a request should use. Must be fast and must never
 * throw: any Redis problem falls back to "use primary, skip the breaker".
 */
export async function selectModel(
  operation: BreakerOperation,
  primaryModel: string,
  fallbackModel: string,
  environment: NodeJS.ProcessEnv = process.env,
  redis?: RedisEval,
): Promise<ModelSelection> {
  try {
    const client = await resolveRedis(environment, redis);
    if (!client) return { model: primaryModel, isPrimary: true, isProbe: false };
    const cfg = breakerConfig(environment);
    const keys = breakerKeys(operation);
    const result = await client.eval(SELECT_SCRIPT, {
      keys: [keys.state, keys.primaryRing, keys.probeLock],
      arguments: [
        String(Date.now()),
        String(cfg.minSamples(operation)),
        String(cfg.failureThreshold),
        String(cfg.cooldownMs),
        String(cfg.minTransitionIntervalMs),
        String(cfg.probeIntervalMs),
        primaryModel,
        fallbackModel,
        String(cfg.probeLockFloorMs(operation)),
      ],
    });
    if (result === "primary" || result === "primary_probe") {
      return { model: primaryModel, isPrimary: true, isProbe: result === "primary_probe" };
    }
    return { model: fallbackModel, isPrimary: false, isProbe: false };
  } catch {
    return { model: primaryModel, isPrimary: true, isProbe: false };
  }
}

async function recordOutcome(
  operation: BreakerOperation,
  wasPrimary: boolean,
  isProbe: boolean,
  isSuccess: boolean,
  environment: NodeJS.ProcessEnv,
  redis?: RedisEval,
): Promise<void> {
  try {
    const client = await resolveRedis(environment, redis);
    if (!client) return;
    const cfg = breakerConfig(environment);
    const keys = breakerKeys(operation);
    const successFlag = isSuccess ? "1" : "0";
    if (wasPrimary) {
      await client.eval(RECORD_PRIMARY_SCRIPT, {
        keys: [keys.state, keys.primaryRing, keys.probeLock, keys.fallbackRing],
        arguments: [
          String(Date.now()),
          successFlag,
          String(cfg.minSamples(operation)),
          String(cfg.recoverStreak),
          String(cfg.minTransitionIntervalMs),
          String(PROBE_INTERVAL_CAP_MS),
          String(cfg.probeIntervalMs),
          isProbe ? "1" : "0",
          String(cfg.probeLockFloorMs(operation)),
        ],
      });
    } else {
      await client.eval(RECORD_FALLBACK_SCRIPT, {
        keys: [keys.state, keys.fallbackRing, keys.probeLock],
        arguments: [successFlag, String(FALLBACK_RING_SIZE), String(cfg.failureThreshold), String(PROBE_INTERVAL_FLOOR_MS)],
      });
    }
  } catch {
    // Optimization layer only; never propagate to the caller.
  }
}

/**
 * Fire-and-forget outcome recording. The caller passes only whether the
 * request succeeded -- mapping a provider outcome to that boolean happens in
 * the integration layer, not here.
 *
 * `isProbe` must be the exact value `selectModel` returned for THIS request
 * (its `ModelSelection.isProbe`). It is NOT safe to re-derive "was this a
 * probe?" from the breaker's current state at record time: a request that
 * started while closed can finish after another concurrent request has
 * already tripped the breaker open, and misclassifying that stale result as
 * a probe would corrupt the recovery streak and backoff schedule.
 */
export function recordOutcomeAsync(
  operation: BreakerOperation,
  wasPrimary: boolean,
  isProbe: boolean,
  isSuccess: boolean,
  environment: NodeJS.ProcessEnv = process.env,
  redis?: RedisEval,
): void {
  void recordOutcome(operation, wasPrimary, isProbe, isSuccess, environment, redis);
}

/** For the admin dashboard. Must never throw -- any Redis problem reports "closed" for every operation. */
export async function readBreakerStatus(
  operations: readonly BreakerOperation[],
  environment: NodeJS.ProcessEnv = process.env,
  redis?: RedisEval,
): Promise<Record<string, BreakerStatus>> {
  const result: Record<string, BreakerStatus> = {};
  for (const operation of operations) result[operation] = { state: "closed", sinceMs: null, currentModel: null };

  try {
    const client = await resolveRedis(environment, redis);
    if (!client) return result;
    const cfg = breakerConfig(environment);
    await Promise.all(
      operations.map(async (operation) => {
        try {
          const keys = breakerKeys(operation);
          const values = await client.eval(STATUS_SCRIPT, { keys: [keys.state], arguments: [] });
          if (!Array.isArray(values)) return;
          const [state, openedAtMsRaw, , primaryModel, fallbackModel] = values as Array<string | null>;
          if (state !== "open") {
            result[operation] = { state: "closed", sinceMs: null, currentModel: primaryModel ?? null };
            return;
          }
          const openedAtMs = openedAtMsRaw ? Number(openedAtMsRaw) : null;
          const probing = openedAtMs !== null && Date.now() - openedAtMs >= cfg.cooldownMs;
          result[operation] = {
            state: probing ? "probing" : "open",
            sinceMs: openedAtMs,
            currentModel: fallbackModel ?? null,
          };
        } catch {
          // Leave the default "closed" entry for this operation.
        }
      }),
    );
  } catch {
    // Leave the default "closed" entries for every operation.
  }
  return result;
}
