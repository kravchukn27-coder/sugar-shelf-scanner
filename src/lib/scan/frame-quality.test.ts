import assert from "node:assert/strict";
import test from "node:test";
import {
  FRAME_QUALITY_DEFAULTS,
  QUALITY_SKIP_FALLBACK_AFTER,
  measureSharpness,
  rgbaToLuma,
  sampleFrameQuality,
  shouldSkipPreflight,
  shouldBypassQualityAfterSkips,
} from "./frame-quality";

const rgba = (values: number[]): Uint8ClampedArray => new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));

test("rgbaToLuma converts RGB and ignores alpha", () => {
  const result = rgbaToLuma(new Uint8ClampedArray([200, 0, 0, 0, 0, 200, 0, 20, 0, 0, 200, 10]), 3, 1);
  assert.deepEqual([...result], [60, 117, 23]);
});

test("flat frame has zero sharpness", () => {
  assert.equal(measureSharpness(new Uint8ClampedArray([100, 100, 100, 100]), 2, 2), 0);
});

test("sharpness increases at a clear local edge", () => {
  const soft = measureSharpness(new Uint8ClampedArray([90, 90, 90, 90, 100, 100, 100, 100]), 4, 2);
  const edge = measureSharpness(new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 255, 255]), 4, 2);
  assert.ok(edge > soft);
});

test("well-exposed textured frame is accepted", () => {
  const data = rgba([80, 80, 80, 80, 160, 160, 160, 160, 90, 90, 90, 90, 170, 170, 170, 170]);
  const quality = sampleFrameQuality(data, 4, 4);
  assert.equal(quality.tooDark, false);
  assert.equal(quality.tooBright, false);
  assert.equal(quality.tooClipped, false);
  assert.equal(quality.tooBlurry, false);
  assert.equal(shouldSkipPreflight(quality), false);
});

test("very dark frame is skipped without being treated as an error", () => {
  const quality = sampleFrameQuality(rgba(new Array(16).fill(5)), 4, 4);
  assert.equal(quality.tooDark, true);
  assert.equal(quality.shouldSkip, true);
  assert.equal(quality.meanLuma, 5);
});

test("very bright and clipped frame is skipped", () => {
  const quality = sampleFrameQuality(rgba(new Array(16).fill(255)), 4, 4);
  assert.equal(quality.tooBright, true);
  assert.equal(quality.tooClipped, true);
  assert.equal(quality.brightPixelRatio, 1);
  assert.equal(quality.shouldSkip, true);
});

test("soft, normally exposed frame is skipped by blur heuristic", () => {
  const quality = sampleFrameQuality(rgba(new Array(16).fill(120)), 4, 4);
  assert.equal(quality.tooDark, false);
  assert.equal(quality.tooBright, false);
  assert.equal(quality.tooBlurry, true);
  assert.equal(quality.sharpness, 0);
  assert.equal(shouldSkipPreflight(quality), true);
});

test("custom thresholds are supported for device calibration", () => {
  const quality = sampleFrameQuality(rgba(new Array(16).fill(30)), 4, 4, {
    minMeanLuma: 20,
    minSharpness: 0,
  });
  assert.equal(quality.tooDark, false);
  assert.equal(quality.tooBlurry, false);
  assert.equal(quality.shouldSkip, false);
  assert.equal(FRAME_QUALITY_DEFAULTS.minMeanLuma, 28);
});

test("invalid dimensions and data are rejected", () => {
  assert.throws(() => rgbaToLuma(new Uint8ClampedArray(3), 1, 1), RangeError);
  assert.throws(() => measureSharpness(new Uint8ClampedArray([1, 2]), 2, 2), RangeError);
});

test("quality gate has a bounded fallback for valid dark or low-texture products", () => {
  assert.equal(shouldBypassQualityAfterSkips(QUALITY_SKIP_FALLBACK_AFTER - 1), false);
  assert.equal(shouldBypassQualityAfterSkips(QUALITY_SKIP_FALLBACK_AFTER), true);
});
