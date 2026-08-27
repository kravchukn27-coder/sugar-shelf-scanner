import assert from "node:assert/strict";
import test from "node:test";
import { sampleFrameQuality } from "./frame-quality";
import { createInitialLiveFrameBaseline, decideLiveFrameSchedulerTick } from "./live-frame-scheduler";

const still = new Uint8ClampedArray(16 * 12).fill(100);
const moving = new Uint8ClampedArray(16 * 12).fill(150);
const texturedRgba = new Uint8ClampedArray(Array.from({ length: 16 }, (_, index) => {
  const value = index % 2 === 0 ? 80 : 170;
  return [value, value, value, 255];
}).flat());
const darkRgba = new Uint8ClampedArray(Array.from({ length: 16 }, () => [5, 5, 5, 255]).flat());
const goodQuality = sampleFrameQuality(texturedRgba, 4, 4);
const badQuality = sampleFrameQuality(darkRgba, 4, 4);

test("creates a camera-ready baseline only while the rollout flag is enabled", () => {
  assert.equal(createInitialLiveFrameBaseline(false, still), null);
  assert.equal(createInitialLiveFrameBaseline(true, null), null);
  assert.equal(createInitialLiveFrameBaseline(true, still), still);
});

test("a still frame following the immediate baseline dispatches on the first scheduler tick", () => {
  const result = decideLiveFrameSchedulerTick({ previous: still, current: still, quality: goodQuality, qualityEnabled: true, qualitySkipStreak: 0 });
  assert.equal(result.action, "dispatch");
  assert.equal(result.qualitySkipStreak, 0);
  assert.equal(result.baseline, still);
});

test("moving frames are skipped and reset the quality streak", () => {
  const result = decideLiveFrameSchedulerTick({ previous: still, current: moving, quality: goodQuality, qualityEnabled: true, qualitySkipStreak: 2 });
  assert.equal(result.action, "motion_skip");
  assert.equal(result.qualitySkipStreak, 0);
  assert.equal(result.baseline, moving);
});

test("quality skips retain the three-skip fallback", () => {
  const first = decideLiveFrameSchedulerTick({ previous: still, current: still, quality: badQuality, qualityEnabled: true, qualitySkipStreak: 0 });
  const second = decideLiveFrameSchedulerTick({ previous: still, current: still, quality: badQuality, qualityEnabled: true, qualitySkipStreak: first.qualitySkipStreak });
  const third = decideLiveFrameSchedulerTick({ previous: still, current: still, quality: badQuality, qualityEnabled: true, qualitySkipStreak: second.qualitySkipStreak });
  assert.equal(first.action, "quality_skip");
  assert.equal(second.action, "quality_skip");
  assert.equal(third.action, "dispatch");
  assert.equal(third.qualitySkipStreak, 0);
});

test("disabled or unavailable quality does not block a still frame", () => {
  assert.equal(decideLiveFrameSchedulerTick({ previous: still, current: still, quality: badQuality, qualityEnabled: false, qualitySkipStreak: 2 }).action, "dispatch");
  assert.equal(decideLiveFrameSchedulerTick({ previous: still, current: still, quality: null, qualityEnabled: true, qualitySkipStreak: 2 }).action, "dispatch");
});
