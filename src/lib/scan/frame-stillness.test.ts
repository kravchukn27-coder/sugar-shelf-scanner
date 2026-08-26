import assert from "node:assert/strict";
import test from "node:test";
import { frameDiff, isFrameMoving, sampleLuma, STILLNESS_THRESHOLD } from "./frame-stillness";

test("frameDiff is 0 for identical arrays", () => {
  const a = new Uint8ClampedArray([10, 20, 30, 40]);
  const b = new Uint8ClampedArray([10, 20, 30, 40]);

  assert.equal(frameDiff(a, b), 0);
});

test("frameDiff computes the mean absolute byte difference for a small uniform delta", () => {
  // Every byte differs by exactly 2, so the mean absolute difference is 2.
  const a = new Uint8ClampedArray([10, 20, 30, 40]);
  const b = new Uint8ClampedArray([12, 18, 32, 38]);

  assert.equal(frameDiff(a, b), 2);
});

test("frameDiff computes the mean absolute byte difference for mixed deltas", () => {
  // Deltas are 5, 0, 15, 20 -> mean = 40 / 4 = 10.
  const a = new Uint8ClampedArray([0, 50, 0, 0]);
  const b = new Uint8ClampedArray([5, 50, 15, 20]);

  assert.equal(frameDiff(a, b), 10);
});

test("frameDiff computes the mean absolute byte difference for a large delta and exceeds the stillness threshold", () => {
  // Every byte differs by exactly 100, so the mean absolute difference is 100.
  const a = new Uint8ClampedArray([0, 0, 0, 0]);
  const b = new Uint8ClampedArray([100, 100, 100, 100]);

  const diff = frameDiff(a, b);
  assert.equal(diff, 100);
  assert.ok(diff > STILLNESS_THRESHOLD);
});

test("frameDiff returns Infinity when array lengths differ", () => {
  const a = new Uint8ClampedArray([1, 2, 3]);
  const b = new Uint8ClampedArray([1, 2]);

  assert.equal(frameDiff(a, b), Infinity);
});

test("frameDiff returns Infinity when both arrays are empty", () => {
  const a = new Uint8ClampedArray([]);
  const b = new Uint8ClampedArray([]);

  assert.equal(frameDiff(a, b), Infinity);
});

test("frameDiff returns Infinity when only one array is empty", () => {
  const a = new Uint8ClampedArray([]);
  const b = new Uint8ClampedArray([1, 2, 3]);

  assert.equal(frameDiff(a, b), Infinity);
});

test("isFrameMoving is false when the diff is well below the stillness threshold", () => {
  const a = new Uint8ClampedArray([0, 0, 0, 0]);
  const b = new Uint8ClampedArray([1, 1, 1, 1]);

  assert.equal(isFrameMoving(a, b), false);
});

test("isFrameMoving is true when the diff is clearly above the stillness threshold", () => {
  const a = new Uint8ClampedArray([0, 0, 0, 0]);
  const b = new Uint8ClampedArray([100, 100, 100, 100]);

  assert.equal(isFrameMoving(a, b), true);
});

test("isFrameMoving is false when the diff exactly equals the stillness threshold (exclusive boundary)", () => {
  // Every byte differs by exactly STILLNESS_THRESHOLD (10), so the mean is
  // exactly 10 -- the documented boundary is `> STILLNESS_THRESHOLD`, so this
  // must NOT count as movement.
  const a = new Uint8ClampedArray([0, 0, 0, 0]);
  const b = new Uint8ClampedArray([
    STILLNESS_THRESHOLD,
    STILLNESS_THRESHOLD,
    STILLNESS_THRESHOLD,
    STILLNESS_THRESHOLD,
  ]);

  assert.equal(frameDiff(a, b), STILLNESS_THRESHOLD);
  assert.equal(isFrameMoving(a, b), false);
});

test("isFrameMoving is true just above the stillness threshold boundary", () => {
  const a = new Uint8ClampedArray([0, 0, 0, 0]);
  const b = new Uint8ClampedArray([
    STILLNESS_THRESHOLD + 1,
    STILLNESS_THRESHOLD + 1,
    STILLNESS_THRESHOLD + 1,
    STILLNESS_THRESHOLD + 1,
  ]);

  assert.equal(isFrameMoving(a, b), true);
});

// sampleLuma needs a CanvasRenderingContext2D, which isn't available outside a
// browser/DOM. We satisfy the minimal shape sampleLuma actually uses --
// getImageData(x, y, w, h) returning { data } -- with a plain object literal
// cast through `unknown`, rather than pulling in jsdom or the `canvas` package.
function fakeCtx(data: number[]): CanvasRenderingContext2D {
  return {
    getImageData: () => ({ data: new Uint8ClampedArray(data) }),
  } as unknown as CanvasRenderingContext2D;
}

test("sampleLuma converts a gray RGBA pixel to the same luma value (coefficients sum to 1.0)", () => {
  // R = G = B = 100 with full alpha. Since 0.299 + 0.587 + 0.114 === 1.0,
  // a gray pixel's luma equals its channel value exactly, independent of
  // rounding, making this an unambiguous hand-computable check.
  const ctx = fakeCtx([100, 100, 100, 255]);

  const luma = sampleLuma(ctx, 1, 1);

  assert.equal(luma.length, 1);
  assert.equal(luma[0], 100);
});

test("sampleLuma converts known per-channel RGBA pixels to the correct luma via 0.299R + 0.587G + 0.114B", () => {
  // A 3x1 image: pure-ish red, green, and blue pixels (alpha ignored by the
  // conversion). Expected values hand-computed from the documented formula,
  // rounded the way Uint8ClampedArray rounds (nearest integer).
  const ctx = fakeCtx([
    200, 0, 0, 255, // 0.299 * 200 = 59.8 -> 60
    0, 200, 0, 255, // 0.587 * 200 = 117.4 -> 117
    0, 0, 200, 255, // 0.114 * 200 = 22.8 -> 23
  ]);

  const luma = sampleLuma(ctx, 3, 1);

  assert.equal(luma.length, 3);
  assert.equal(luma[0], 60);
  assert.equal(luma[1], 117);
  assert.equal(luma[2], 23);
});
