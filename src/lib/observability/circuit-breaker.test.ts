import assert from "node:assert/strict";
import test from "node:test";
import { readBreakerStatus, recordOutcomeAsync, selectModel, type RedisEval } from "./circuit-breaker";

/**
 * In-memory fake that reimplements the exact semantics of the module's Lua
 * scripts (hash / list / SET NX PX) without parsing Lua. The four scripts
 * are distinguishable purely by their keys/arguments shape:
 *   select:          3 keys, 8 args
 *   record primary:  4 keys, 7 args
 *   record fallback: 3 keys, 4 args
 *   status:          1 key,  0 args
 * This mirrors the CounterRedis pattern in redis-guard.test.ts -- a small
 * in-memory model of what the scripts compute, rather than a Lua interpreter.
 *
 * Note: `.eval(...)` below is node-redis's Lua script runner method (the
 * same interface `redis-guard.ts` mocks in its own tests), not JavaScript's
 * global eval(). This fake never evaluates any string as code.
 */
class FakeBreakerRedis implements RedisEval {
  hashes = new Map<string, Map<string, string>>();
  lists = new Map<string, string[]>();
  locks = new Map<string, { value: string; expiresAt: number }>();

  private hash(key: string) {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    return this.hashes.get(key)!;
  }

  private list(key: string) {
    if (!this.lists.has(key)) this.lists.set(key, []);
    return this.lists.get(key)!;
  }

  private setNx(key: string, value: string, ttlMs: number) {
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > Date.now()) return false;
    this.locks.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async eval(_script: string, { keys, arguments: args }: { keys: string[]; arguments: string[] }): Promise<unknown> {
    if (keys.length === 3 && args.length === 8) return this.select(keys, args);
    if (keys.length === 4 && args.length === 7) return this.recordPrimary(keys, args);
    if (keys.length === 3 && args.length === 4) return this.recordFallback(keys, args);
    if (keys.length === 1 && args.length === 0) return this.status(keys);
    throw new Error(`FakeBreakerRedis: unrecognized eval shape (${keys.length} keys, ${args.length} args)`);
  }

  private select(keys: string[], args: string[]) {
    const [stateKey, primaryRingKey, probeLockKey] = keys;
    const [nowStr, minSamplesStr, thresholdStr, cooldownStr, minTransitionStr, baseIntervalStr, primaryModel, fallbackModel] = args;
    const now = Number(nowStr);
    const state = this.hash(stateKey!);
    state.set("primaryModel", primaryModel!);
    state.set("fallbackModel", fallbackModel!);

    if (state.get("state") !== "open") {
      const minSamples = Number(minSamplesStr);
      const ring = this.list(primaryRingKey!);
      if (ring.length >= minSamples) {
        const failures = ring.filter((v) => v === "0").length;
        const rate = failures / ring.length;
        if (rate >= Number(thresholdStr)) {
          const lastTransitionRaw = state.get("lastTransitionAtMs");
          const lastTransition = lastTransitionRaw ? Number(lastTransitionRaw) : null;
          if (lastTransition === null || now - lastTransition >= Number(minTransitionStr)) {
            state.set("state", "open");
            state.set("openedAtMs", String(now));
            state.set("lastTransitionAtMs", String(now));
            state.set("probeIntervalMs", baseIntervalStr!);
            state.set("recoverStreak", "0");
            state.set("fastPath", "0");
            return "fallback";
          }
        }
      }
      return "primary";
    }

    const openedAtMsRaw = state.get("openedAtMs");
    const openedAtMs = openedAtMsRaw ? Number(openedAtMsRaw) : null;
    if (openedAtMs === null || now - openedAtMs < Number(cooldownStr)) return "fallback";

    const intervalRaw = state.get("probeIntervalMs");
    const interval = intervalRaw ? Number(intervalRaw) : Number(baseIntervalStr);
    return this.setNx(probeLockKey!, "1", interval) ? "primary_probe" : "fallback";
  }

  private recordPrimary(keys: string[], args: string[]) {
    const [stateKey, primaryRingKey, probeLockKey, fallbackRingKey] = keys;
    const [nowStr, successStr, minSamplesStr, recoverStreakStr, minTransitionStr, capStr, baseStr] = args;
    const state = this.hash(stateKey!);

    if (state.get("state") !== "open") {
      const ring = this.list(primaryRingKey!);
      ring.unshift(successStr!);
      ring.length = Math.min(ring.length, Number(minSamplesStr));
      return "recorded_closed";
    }

    const now = Number(nowStr);
    const lastTransitionRaw = state.get("lastTransitionAtMs");
    const lastTransition = lastTransitionRaw ? Number(lastTransitionRaw) : null;

    if (successStr === "1") {
      const streak = Number(state.get("recoverStreak") ?? "0") + 1;
      state.set("recoverStreak", String(streak));
      const fastPath = state.get("fastPath") === "1";
      const bar = fastPath ? 1 : Number(recoverStreakStr);
      if (streak >= bar && (lastTransition === null || now - lastTransition >= Number(minTransitionStr))) {
        state.set("state", "closed");
        state.set("lastTransitionAtMs", String(now));
        state.set("recoverStreak", "0");
        state.set("fastPath", "0");
        this.lists.delete(primaryRingKey!);
        this.lists.delete(fallbackRingKey!);
        this.locks.delete(probeLockKey!);
        return "closed";
      }
      return "probe_success";
    }

    state.set("recoverStreak", "0");
    const currentRaw = state.get("probeIntervalMs");
    const current = currentRaw ? Number(currentRaw) : Number(baseStr);
    const cap = Number(capStr);
    const next = Math.min(current * 2, cap);
    state.set("probeIntervalMs", String(next));
    return "probe_failed";
  }

  private recordFallback(keys: string[], args: string[]) {
    const [stateKey, fallbackRingKey, probeLockKey] = keys;
    const [successStr, sizeStr, thresholdStr, floorStr] = args;
    const state = this.hash(stateKey!);
    if (state.get("state") !== "open") return "ignored";

    const ring = this.list(fallbackRingKey!);
    ring.unshift(successStr!);
    const size = Number(sizeStr);
    ring.length = Math.min(ring.length, size);
    if (ring.length >= size) {
      const failures = ring.filter((v) => v === "0").length;
      const rate = failures / ring.length;
      if (rate >= Number(thresholdStr)) {
        state.set("probeIntervalMs", floorStr!);
        state.set("fastPath", "1");
        this.locks.delete(probeLockKey!);
        return "degraded";
      }
    }
    return "recorded";
  }

  private status(keys: string[]) {
    const state = this.hash(keys[0]!);
    return [
      state.get("state") ?? null,
      state.get("openedAtMs") ?? null,
      state.get("lastTransitionAtMs") ?? null,
      state.get("primaryModel") ?? null,
      state.get("fallbackModel") ?? null,
    ];
  }
}

class ThrowingRedis implements RedisEval {
  async eval(): Promise<unknown> {
    throw new Error("redis unavailable");
  }
}

function env(overrides: Partial<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    GEMINI_BREAKER_MIN_SAMPLES_PREFLIGHT: "8",
    GEMINI_BREAKER_MIN_SAMPLES_ANALYZE: "5",
    GEMINI_BREAKER_FAILURE_THRESHOLD: "0.4",
    GEMINI_BREAKER_COOLDOWN_MS: "40",
    GEMINI_BREAKER_PROBE_INTERVAL_MS: "30",
    GEMINI_BREAKER_RECOVER_STREAK: "3",
    GEMINI_BREAKER_MIN_TRANSITION_INTERVAL_MS: "20",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv;
}

const PRIMARY = "gemini-3.5-flash-lite";
const FALLBACK = "gemini-3.6-flash";

/** Flush pending microtasks so a fire-and-forget recordOutcomeAsync call settles before assertions. */
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function tripBreaker(redis: FakeBreakerRedis, environment: NodeJS.ProcessEnv, operation: "preflight" | "analyze", samples: number) {
  // Fill the primary ring with `samples` failures (each request sees the
  // ring below MIN_SAMPLES while it's being filled, so it gets primary).
  for (let i = 0; i < samples; i += 1) {
    await selectModel(operation, PRIMARY, FALLBACK, environment, redis);
    recordOutcomeAsync(operation, true, false, environment, redis);
    await flush();
  }
  // This request is the first one to see a full, all-failing ring: it both
  // trips the breaker and should itself get the fallback.
  return selectModel(operation, PRIMARY, FALLBACK, environment, redis);
}

test("closed state stays closed below MIN_SAMPLES even with all failures", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env();
  for (let i = 0; i < 4; i += 1) {
    const selection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
    assert.equal(selection.isPrimary, true);
    recordOutcomeAsync("analyze", true, false, environment, redis);
    await flush();
  }
  const selection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
  assert.equal(selection.model, PRIMARY);
});

test("closed state stays closed when failure rate is below threshold", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env();
  // analyze MIN_SAMPLES = 5. 1 failure / 5 = 20% < 40% threshold.
  const outcomes = [true, true, true, true, false];
  for (const success of outcomes) {
    await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
    recordOutcomeAsync("analyze", true, success, environment, redis);
    await flush();
  }
  const selection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
  assert.equal(selection.model, PRIMARY);
  assert.equal(selection.isPrimary, true);
});

test("trips to open once failure rate crosses threshold with enough samples, and the tripping request gets fallback", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env();
  const tripSelection = await tripBreaker(redis, environment, "analyze", 5);
  assert.equal(tripSelection.model, FALLBACK);
  assert.equal(tripSelection.isPrimary, false);
});

test("during cooldown every request gets fallback with no probing", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env({ GEMINI_BREAKER_COOLDOWN_MS: "500" });
  await tripBreaker(redis, environment, "analyze", 5);
  for (let i = 0; i < 5; i += 1) {
    const selection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
    assert.equal(selection.isPrimary, false, "must stay on fallback during cooldown");
  }
});

test("after cooldown, exactly one concurrent request gets the probe slot per interval", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env({ GEMINI_BREAKER_COOLDOWN_MS: "20", GEMINI_BREAKER_PROBE_INTERVAL_MS: "10000" });
  await tripBreaker(redis, environment, "analyze", 5);
  await new Promise((resolve) => setTimeout(resolve, 30)); // let cooldown elapse

  const selections = await Promise.all(
    Array.from({ length: 6 }, () => selectModel("analyze", PRIMARY, FALLBACK, environment, redis)),
  );
  const primaries = selections.filter((s) => s.isPrimary);
  assert.equal(primaries.length, 1, "only one request should win the probe slot");
});

test("a failed probe doubles the interval, resets the streak, and caps at 30 minutes", async () => {
  const redis = new FakeBreakerRedis();
  // Start near the 30-minute cap so doubling clamps quickly without real waiting.
  const environment = env({ GEMINI_BREAKER_COOLDOWN_MS: "1", GEMINI_BREAKER_PROBE_INTERVAL_MS: String(1_000_000) });
  await tripBreaker(redis, environment, "analyze", 5);

  // Acquire the probe slot and fail it.
  await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
  recordOutcomeAsync("analyze", true, false, environment, redis);
  await flush();

  const stateKey = "sugar:v1:breaker:analyze:state";
  const intervalAfterOne = Number(redis.hashes.get(stateKey)?.get("probeIntervalMs"));
  assert.equal(intervalAfterOne, 1_800_000, "1_000_000 * 2 = 2_000_000 must clamp to the 30-minute cap");
  const streakAfterFailure = redis.hashes.get(stateKey)?.get("recoverStreak");
  assert.equal(streakAfterFailure, "0");

  // Failing again while already at the cap must stay at the cap.
  recordOutcomeAsync("analyze", true, false, environment, redis);
  await flush();
  const intervalAfterTwo = Number(redis.hashes.get(stateKey)?.get("probeIntervalMs"));
  assert.equal(intervalAfterTwo, 1_800_000);
});

test("3 consecutive successful probes closes the breaker and resets ring buffers", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env({ GEMINI_BREAKER_COOLDOWN_MS: "1", GEMINI_BREAKER_PROBE_INTERVAL_MS: "5", GEMINI_BREAKER_MIN_TRANSITION_INTERVAL_MS: "1" });
  await tripBreaker(redis, environment, "analyze", 5);

  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10)); // let the probe lock expire between attempts
    const selection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
    assert.equal(selection.isPrimary, true, `attempt ${i} should win the probe slot`);
    recordOutcomeAsync("analyze", true, true, environment, redis);
    await flush();
  }

  const stateKey = "sugar:v1:breaker:analyze:state";
  assert.equal(redis.hashes.get(stateKey)?.get("state"), "closed");

  const closedSelection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
  assert.equal(closedSelection.isPrimary, true);
  assert.equal(redis.lists.get("sugar:v1:breaker:analyze:primary:ring")?.length ?? 0, 0, "primary ring was reset on close and nothing has been recorded since");
});

test("fallback-degraded fast path: probe interval drops to the 10s floor, the slot opens immediately, and 1 success closes it", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env({ GEMINI_BREAKER_COOLDOWN_MS: "1", GEMINI_BREAKER_PROBE_INTERVAL_MS: "50000", GEMINI_BREAKER_MIN_TRANSITION_INTERVAL_MS: "1" });
  await tripBreaker(redis, environment, "analyze", 5);
  // `cooldownMs` is 1ms specifically so cooldown is irrelevant to what this
  // test actually exercises (the fast-path recovery). But `flush()` only
  // yields via setImmediate, which doesn't reliably cross a Date.now() tick
  // -- without a real timer wait here, tripping and the fast-path check
  // below can land in the very same millisecond and "now - openedAtMs < 1"
  // incorrectly blocks the probe. A tiny real wait makes the cooldown
  // check's outcome deterministic.
  await new Promise((resolve) => setTimeout(resolve, 5));

  // Feed fallback failures (non-probe requests routed to fallback) until its own 5-entry ring trips.
  for (let i = 0; i < 5; i += 1) {
    recordOutcomeAsync("analyze", false, false, environment, redis);
    await flush();
  }

  const stateKey = "sugar:v1:breaker:analyze:state";
  assert.equal(redis.hashes.get(stateKey)?.get("probeIntervalMs"), "10000", "must drop to the 10s floor");
  assert.equal(redis.hashes.get(stateKey)?.get("fastPath"), "1");
  assert.equal(redis.locks.has("sugar:v1:breaker:analyze:probe:lock"), false, "probe slot must be immediately available");

  const selection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
  assert.equal(selection.isPrimary, true, "probe slot should be free right away, not waiting out the old backoff");

  recordOutcomeAsync("analyze", true, true, environment, redis);
  await flush();
  assert.equal(redis.hashes.get(stateKey)?.get("state"), "closed", "only 1 success needed to close during fast-path recovery");
});

test("flap guard prevents a second state transition within the min-transition-interval", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env({ GEMINI_BREAKER_MIN_TRANSITION_INTERVAL_MS: "10000" });
  await tripBreaker(redis, environment, "analyze", 5);
  const stateKey = "sugar:v1:breaker:analyze:state";
  const openedAt = redis.hashes.get(stateKey)?.get("openedAtMs");
  assert.ok(openedAt);

  // While cooldown is still active, repeated calls must not touch the transition
  // fields at all -- confirming the state hasn't churned within the guard window.
  await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
  assert.equal(redis.hashes.get(stateKey)?.get("openedAtMs"), openedAt, "no spurious transition while guard window is active");
  assert.equal(redis.hashes.get(stateKey)?.get("lastTransitionAtMs"), openedAt, "lastTransitionAtMs unchanged since the original trip");
});

test("fail-open: selectModel returns primary and readBreakerStatus/recordOutcomeAsync never throw when Redis errors", async () => {
  const redis = new ThrowingRedis();
  const environment = env();

  const selection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
  assert.deepEqual(selection, { model: PRIMARY, isPrimary: true });

  assert.doesNotThrow(() => recordOutcomeAsync("analyze", true, true, environment, redis));
  await flush();

  const status = await readBreakerStatus(["preflight", "analyze"], environment, redis);
  assert.deepEqual(status, {
    preflight: { state: "closed", sinceMs: null, currentModel: null },
    analyze: { state: "closed", sinceMs: null, currentModel: null },
  });
});

test("preflight and analyze breakers are fully independent", async () => {
  const redis = new FakeBreakerRedis();
  const environment = env();

  await tripBreaker(redis, environment, "preflight", 8);

  const analyzeSelection = await selectModel("analyze", PRIMARY, FALLBACK, environment, redis);
  assert.equal(analyzeSelection.isPrimary, true, "tripping preflight must not affect analyze");

  const preflightSelection = await selectModel("preflight", PRIMARY, FALLBACK, environment, redis);
  assert.equal(preflightSelection.isPrimary, false, "preflight stays open on its own key namespace");

  assert.ok(redis.hashes.has("sugar:v1:breaker:preflight:state"));
  assert.notEqual(redis.hashes.get("sugar:v1:breaker:analyze:state")?.get("state"), "open");
});

test("selectModel never throws or hangs when the injected redis client always rejects", async () => {
  const redis = new ThrowingRedis();
  await assert.doesNotReject(selectModel("preflight", PRIMARY, FALLBACK, env(), redis));
});
