import assert from "node:assert/strict";
import test from "node:test";
import { RATE_LIMIT_POLICIES, RedisGuardUnavailableError, checkSharedRateLimit, reserveGeminiRequest } from "./redis-guard";

class CounterRedis {
  counts = new Map<string, number>();
  async eval(_script: string, options: { keys: string[]; arguments: string[] }) {
    const key = options.keys[0]!;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return [next, 60_000];
  }
}

const environment = { NODE_ENV: "test", RATE_LIMIT_SECRET: "a-test-rate-limit-secret" } as NodeJS.ProcessEnv;
const request = (installation = "a".repeat(32)) => new Request("https://scanner.test/api/scan/analyze", {
  headers: { "x-forwarded-for": "203.0.113.10", "x-sugar-installation": installation },
});

test("the confirmed analyze policy is ten requests per minute per installation", () => {
  assert.deepEqual(RATE_LIMIT_POLICIES.analyze, {
    installation: { limit: 10, windowMs: 60_000 },
    ip: { limit: 30, windowMs: 60_000 },
  });
});

test("shared limiter rejects the eleventh analyze from one installation", async () => {
  const redis = new CounterRedis();
  for (let index = 0; index < 10; index += 1) assert.equal((await checkSharedRateLimit(request(), "analyze", environment, redis)).allowed, true);
  const denied = await checkSharedRateLimit(request(), "analyze", environment, redis);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 60);
});

test("IP guard still limits a caller that keeps replacing its installation id", async () => {
  const redis = new CounterRedis();
  for (let index = 0; index < 30; index += 1) assert.equal((await checkSharedRateLimit(request(index.toString(16).padStart(32, "0")), "analyze", environment, redis)).allowed, true);
  assert.equal((await checkSharedRateLimit(request("f".repeat(32)), "analyze", environment, redis)).allowed, false);
});

test("production fails closed when the rate-limit secret is missing", async () => {
  await assert.rejects(
    checkSharedRateLimit(request(), "analyze", { NODE_ENV: "production", REDIS_URL: "redis://example" } as NodeJS.ProcessEnv, new CounterRedis()),
    RedisGuardUnavailableError,
  );
});

test("production request budget is rejected when Redis cannot reserve it", async () => {
  const redis = { eval: async () => 0 };
  await assert.rejects(
    reserveGeminiRequest({ NODE_ENV: "production", REDIS_URL: "redis://example", GEMINI_REQUESTS_PER_MINUTE_LIMIT: "120", GEMINI_REQUESTS_PER_DAY_LIMIT: "10000" } as NodeJS.ProcessEnv, redis),
    RedisGuardUnavailableError,
  );
});
