import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRunScannerScheduler,
  shouldStopCameraTracks,
  transitionScannerLifecycle,
  type ScannerLifecycleState,
} from "./scanner-lifecycle";

test("runs the normal start, capture, analyze, and result lifecycle", () => {
  let state: ScannerLifecycleState = "camera_off";
  state = transitionScannerLifecycle(state, "START");
  state = transitionScannerLifecycle(state, "CAPTURED");
  state = transitionScannerLifecycle(state, "ANALYZE_SUCCESS");

  assert.equal(state, "results");
});

test("runs the scheduler only while looking for a valid live frame", () => {
  const states: ScannerLifecycleState[] = ["camera_off", "live_searching", "captured_analyzing", "results", "no_scene", "error"];
  assert.deepEqual(states.filter(shouldRunScannerScheduler), ["live_searching"]);
});

test("does not automatically retry no-scene or error states", () => {
  assert.equal(transitionScannerLifecycle("no_scene", "ANALYZE_SUCCESS"), "no_scene");
  assert.equal(transitionScannerLifecycle("error", "CAPTURED"), "error");
  assert.equal(transitionScannerLifecycle("no_scene", "RETRY"), "live_searching");
  assert.equal(transitionScannerLifecycle("error", "RETRY"), "live_searching");
});

test("maps both preflight and full analysis failures to a stopped retry state", () => {
  assert.equal(transitionScannerLifecycle("live_searching", "NO_SCENE"), "no_scene");
  assert.equal(transitionScannerLifecycle("captured_analyzing", "NO_SCENE"), "no_scene");
  assert.equal(transitionScannerLifecycle("live_searching", "ANALYZE_FAILURE"), "error");
  assert.equal(transitionScannerLifecycle("captured_analyzing", "ANALYZE_FAILURE"), "error");
});

test("close camera always wins, stops tracks, and rejects delayed callbacks", () => {
  for (const state of ["camera_off", "live_searching", "captured_analyzing", "results", "no_scene", "error"] as const) {
    const closed = transitionScannerLifecycle(state, "CLOSE_CAMERA");
    assert.equal(closed, "camera_off");
    assert.equal(shouldStopCameraTracks(closed), true);
    assert.equal(transitionScannerLifecycle(closed, "ANALYZE_SUCCESS"), "camera_off");
  }
});

test("ignores lifecycle events that are invalid for the current state", () => {
  assert.equal(transitionScannerLifecycle("camera_off", "CAPTURED"), "camera_off");
  assert.equal(transitionScannerLifecycle("live_searching", "START"), "live_searching");
  assert.equal(transitionScannerLifecycle("results", "ANALYZE_SUCCESS"), "results");
});
