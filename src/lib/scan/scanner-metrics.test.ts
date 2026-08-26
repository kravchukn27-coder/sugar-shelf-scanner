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
    preflightRttMs: 275,
    analyzeRttMs: 75,
    renderMs: 25,
    preflightAttempts: 1,
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
