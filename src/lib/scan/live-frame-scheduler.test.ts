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
  const result = decideLiveFrameSchedulerTick({ previous: still, current: still, quality: goodQuality, qualityEnabled: true, qualitySkipStreak: 0, motionSkipStreak: 0 });
  assert.equal(result.action, "dispatch");
  assert.equal(result.qualitySkipStreak, 0);
  assert.equal(result.motionSkipStreak, 0);
  assert.equal(result.baseline, still);
});

test("moving frames are skipped and reset the quality streak", () => {
  const result = decideLiveFrameSchedulerTick({ previous: still, current: moving, quality: goodQuality, qualityEnabled: true, qualitySkipStreak: 2, motionSkipStreak: 0 });
  assert.equal(result.action, "motion_skip");
  assert.equal(result.qualitySkipStreak, 0);
  assert.equal(result.motionSkipStreak, 1);
  assert.equal(result.baseline, moving);
});

test("quality skips retain the two-skip fallback", () => {
  const first = decideLiveFrameSchedulerTick({ previous: still, current: still, quality: badQuality, qualityEnabled: true, qualitySkipStreak: 0, motionSkipStreak: 0 });
  const second = decideLiveFrameSchedulerTick({ previous: still, current: still, quality: badQuality, qualityEnabled: true, qualitySkipStreak: first.qualitySkipStreak, motionSkipStreak: 0 });
  assert.equal(first.action, "quality_skip");
  assert.equal(second.action, "dispatch");
  assert.equal(second.qualitySkipStreak, 0);
});

test("disabled or unavailable quality does not block a still frame", () => {
  assert.equal(decideLiveFrameSchedulerTick({ previous: still, current: still, quality: badQuality, qualityEnabled: false, qualitySkipStreak: 2, motionSkipStreak: 0 }).action, "dispatch");
  assert.equal(decideLiveFrameSchedulerTick({ previous: still, current: still, quality: null, qualityEnabled: true, qualitySkipStreak: 2, motionSkipStreak: 0 }).action, "dispatch");
});

test("persistent motion has a bounded fallback, unlike before", () => {
  const first = decideLiveFrameSchedulerTick({ previous: still, current: moving, quality: goodQuality, qualityEnabled: true, qualitySkipStreak: 0, motionSkipStreak: 0 });
  const second = decideLiveFrameSchedulerTick({ previous: still, current: moving, quality: goodQuality, qualityEnabled: true, qualitySkipStreak: 0, motionSkipStreak: first.motionSkipStreak });
  const third = decideLiveFrameSchedulerTick({ previous: still, current: moving, quality: goodQuality, qualityEnabled: true, qualitySkipStreak: 0, motionSkipStreak: second.motionSkipStreak });
  assert.equal(first.action, "motion_skip");
  assert.equal(second.action, "motion_skip");
  assert.equal(third.action, "dispatch");
  assert.equal(third.motionSkipStreak, 0);
});

test("a bypassed motion skip still respects the quality gate", () => {
  const first = decideLiveFrameSchedulerTick({ previous: still, current: moving, quality: badQuality, qualityEnabled: true, qualitySkipStreak: 0, motionSkipStreak: 0 });
  const second = decideLiveFrameSchedulerTick({ previous: still, current: moving, quality: badQuality, qualityEnabled: true, qualitySkipStreak: 0, motionSkipStreak: first.motionSkipStreak });
  const third = decideLiveFrameSchedulerTick({ previous: still, current: moving, quality: badQuality, qualityEnabled: true, qualitySkipStreak: 0, motionSkipStreak: second.motionSkipStreak });
  assert.equal(third.action, "quality_skip");
});
