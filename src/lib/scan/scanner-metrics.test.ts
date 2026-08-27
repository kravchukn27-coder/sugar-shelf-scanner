import assert from "node:assert/strict";
import test from "node:test";
import { createScannerMetrics } from "./scanner-metrics";

function testClock(...values: number[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

test("buckets aggregate timings and counts only dispatched preflight attempts", () => {
  const metrics = createScannerMetrics(testClock(0, 55, 60, 120, 390, 400, 460, 500, 520));
  metrics.reset();
  metrics.markCaptureReady();
  metrics.recordCaptureEncode(0);
  const preflight = metrics.startRequest("preflight");
  metrics.finishRequest("preflight", preflight);
  const analyze = metrics.startRequest("analyze");
  metrics.finishRequest("analyze", analyze);
  metrics.startRender();
  metrics.markRendered();

  assert.deepEqual(metrics.terminal("analysis_completed"), {
    completion: "analysis_completed",
    captureReadyMs: 75,
    captureEncodeMs: 75,
    timeToFirstPreflightDispatchMs: 125,
    preflightLastRttMs: 275,
    preflightTotalRttMs: 275,
    analyzeRttMs: 75,
    renderMs: 25,
    preflightAttempts: 1,
    motionSkipped: 0,
    qualitySkipped: 0,
  });
});

test("emits one terminal summary and discard prevents stale callbacks", () => {
  const metrics = createScannerMetrics(() => 0);
  metrics.reset();
  metrics.startRequest("preflight");
  assert.equal(metrics.terminal("preflight_terminal")?.preflightAttempts, 1);
  assert.equal(metrics.terminal("request_failure"), null);
  metrics.reset();
  metrics.discard();
  assert.equal(metrics.terminal("request_failure"), null);
});

test("caps a noisy scanner run without storing unbounded values", () => {
  const metrics = createScannerMetrics(() => 0);
  metrics.reset();
  for (let index = 0; index < 100; index += 1) metrics.startRequest("preflight");
  assert.equal(metrics.terminal("preflight_terminal")?.preflightAttempts, 90);
});

test("caps aggregate quality skips without retaining frame details", () => {
  const metrics = createScannerMetrics(() => 0);
  metrics.reset();
  metrics.recordQualitySkip();
  metrics.recordQualitySkip();
  assert.equal(metrics.terminal("preflight_terminal")?.qualitySkipped, 2);
});

test("records motion skips separately from quality skips", () => {
  const metrics = createScannerMetrics(() => 0);
  metrics.reset();
  metrics.recordMotionSkip();
  metrics.recordMotionSkip();
  metrics.recordQualitySkip();
  assert.deepEqual(metrics.terminal("preflight_terminal"), {
    completion: "preflight_terminal",
    preflightAttempts: 0,
    motionSkipped: 2,
    qualitySkipped: 1,
  });
});

test("keeps both the last and total preflight RTT", () => {
  const metrics = createScannerMetrics(testClock(0, 10, 110, 130, 330));
  metrics.reset();
  const first = metrics.startRequest("preflight");
  metrics.finishRequest("preflight", first);
  const second = metrics.startRequest("preflight");
  metrics.finishRequest("preflight", second);
  assert.deepEqual(metrics.terminal("preflight_terminal"), {
    completion: "preflight_terminal",
    timeToFirstPreflightDispatchMs: 25,
    preflightLastRttMs: 200,
    preflightTotalRttMs: 300,
    preflightAttempts: 2,
    motionSkipped: 0,
    qualitySkipped: 0,
  });
});
