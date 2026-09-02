import assert from "node:assert/strict";
import test from "node:test";

import { NO_SCENE_GRACE_MS, cameraBecameLive, requestedCamera, shouldHoldNoSceneFailure } from "./no-scene-grace";

test("a negative verdict cannot be terminal while the camera has not started", () => {
  const window = requestedCamera();
  assert.equal(shouldHoldNoSceneFailure(window, 0), true);
  assert.equal(shouldHoldNoSceneFailure(window, 60_000), true);
});

test("the permission dialog does not consume the aiming window", () => {
  // The user taps at t=0, reads the iOS permission sheet, and allows at t=9s.
  const requested = requestedCamera();
  const live = cameraBecameLive(requested, 9_000);
  // First preflight answer lands ~650ms plus a round trip after that.
  assert.equal(shouldHoldNoSceneFailure(live, 9_650), true);
  assert.equal(shouldHoldNoSceneFailure(live, 9_000 + NO_SCENE_GRACE_MS - 1), true);
  assert.equal(shouldHoldNoSceneFailure(live, 9_000 + NO_SCENE_GRACE_MS), false);
});

test("the window starts once, at the first live frame, and later frames do not extend it", () => {
  const live = cameraBecameLive(requestedCamera(), 1_000);
  assert.equal(cameraBecameLive(live, 3_000).liveSince, 1_000);
  assert.equal(shouldHoldNoSceneFailure(cameraBecameLive(live, 3_000), 5_001), false);
});

test("a retry restarts the window instead of inheriting the previous session's clock", () => {
  const first = cameraBecameLive(requestedCamera(), 1_000);
  assert.equal(shouldHoldNoSceneFailure(first, 20_000), false);
  const retried = cameraBecameLive(requestedCamera(), 20_100);
  assert.equal(shouldHoldNoSceneFailure(retried, 20_500), true);
});
