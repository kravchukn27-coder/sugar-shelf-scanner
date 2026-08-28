import assert from "node:assert/strict";
import test from "node:test";
import {
  getCanvasBackingSize,
  getContinuationCrop,
  getCoverCrop,
  getRoundedRectFeatherAlpha,
  shouldRenderCanvasFrame,
} from "./canvas-preview";

test("the backdrop crop keeps the viewfinder's scale so the blur continues it", () => {
  const source = { width: 1440, height: 1080 };
  const viewfinder = { width: 362, height: 482 };
  const scene = { width: 429, height: 690 };

  const reference = getCoverCrop(source, viewfinder);
  const continuation = getContinuationCrop(source, viewfinder, scene);
  assert.ok(reference && continuation);

  // One source pixel must land on the same number of CSS pixels in both, which
  // is what makes the backdrop read as the same picture carrying on.
  const viewfinderScale = viewfinder.width / reference.sw;
  assert.ok(Math.abs(scene.width / continuation.sw - viewfinderScale) < 1e-9);
  assert.ok(Math.abs(scene.height / continuation.sh - viewfinderScale) < 1e-9);

  // Both stay centred on the same point, so the frame sits exactly over the
  // part of the backdrop it repeats.
  assert.ok(Math.abs((reference.sx + reference.sw / 2) - (continuation.sx + continuation.sw / 2)) < 1e-9);
  assert.ok(Math.abs((reference.sy + reference.sh / 2) - (continuation.sy + continuation.sh / 2)) < 1e-9);
});

test("a portrait viewfinder over a landscape camera asks for rows that do not exist", () => {
  // The caller must expect this and stretch the edge rows; silently re-cropping
  // here is what made the old backdrop a larger, misaligned second picture.
  const continuation = getContinuationCrop({ width: 1440, height: 1080 }, { width: 362, height: 482 }, { width: 429, height: 690 });
  assert.ok(continuation);
  assert.ok(continuation.sy < 0);
  assert.ok(continuation.sy + continuation.sh > 1080);
  assert.ok(continuation.sx > 0);
  assert.ok(continuation.sx + continuation.sw < 1440);
});

test("rejects a continuation without a usable source, reference or destination", () => {
  assert.equal(getContinuationCrop({ width: 0, height: 1080 }, { width: 362, height: 482 }, { width: 429, height: 690 }), null);
  assert.equal(getContinuationCrop({ width: 1440, height: 1080 }, { width: 0, height: 482 }, { width: 429, height: 690 }), null);
  assert.equal(getContinuationCrop({ width: 1440, height: 1080 }, { width: 362, height: 482 }, { width: 429, height: 0 }), null);
});

test("creates the centred 3:4 crop of a 4:3 Safari camera frame", () => {
  assert.deepEqual(getCoverCrop({ width: 1920, height: 1440 }, { width: 402, height: 536 }), {
    sx: 420,
    sy: 0,
    sw: 1080,
    sh: 1440,
  });
});

test("uses the full source when source and destination aspects match", () => {
  assert.deepEqual(getCoverCrop({ width: 1440, height: 1920 }, { width: 402, height: 536 }), {
    sx: 0,
    sy: 0,
    sw: 1440,
    sh: 1920,
  });
});

test("rejects unusable crop geometry", () => {
  assert.equal(getCoverCrop({ width: 0, height: 1440 }, { width: 402, height: 536 }), null);
  assert.equal(getCoverCrop({ width: 1920, height: 1440 }, { width: 0, height: 536 }), null);
});

test("caps backing resolution while retaining the CSS aspect ratio", () => {
  const backing = getCanvasBackingSize({ width: 402, height: 714 }, 3, 1_250_000, 2);
  assert.ok(backing);
  assert.ok(backing.width * backing.height <= 1_252_000);
  assert.ok(backing.pixelRatio <= 2);
  assert.ok(Math.abs(backing.width / backing.height - 402 / 714) < 0.003);
});

test("does not render more often than a target FPS", () => {
  assert.equal(shouldRenderCanvasFrame(null, 100, 30), true);
  assert.equal(shouldRenderCanvasFrame(100, 132, 30), false);
  assert.equal(shouldRenderCanvasFrame(100, 134, 30), true);
  assert.equal(shouldRenderCanvasFrame(100, 150, 0), false);
});

test("feathers a straight edge with a smoothstep curve", () => {
  const size = { width: 100, height: 80 };
  assert.equal(getRoundedRectFeatherAlpha({ x: 0, y: 40 }, size, 10), 0);
  assert.equal(getRoundedRectFeatherAlpha({ x: 5, y: 40 }, size, 10), 0.5);
  assert.equal(getRoundedRectFeatherAlpha({ x: 10, y: 40 }, size, 10), 1);
  assert.equal(getRoundedRectFeatherAlpha({ x: 50, y: 40 }, size, 10), 1);
});

test("uses rounded-corner distance for the feather mask", () => {
  const size = { width: 100, height: 80 };
  assert.equal(getRoundedRectFeatherAlpha({ x: 0, y: 0 }, size, 10, 20), 0);
  assert.equal(getRoundedRectFeatherAlpha({ x: 20, y: 0 }, size, 10, 20), 0);
  assert.equal(getRoundedRectFeatherAlpha({ x: 20, y: 10 }, size, 10, 20), 1);
  assert.equal(getRoundedRectFeatherAlpha({ x: 50, y: 40 }, size, 10, 20), 1);
});

test("keeps feather geometry stable when scaled to a canvas backing store", () => {
  const cssAlpha = getRoundedRectFeatherAlpha({ x: 5, y: 40 }, { width: 100, height: 80 }, 10, 20);
  const backingAlpha = getRoundedRectFeatherAlpha({ x: 10, y: 80 }, { width: 200, height: 160 }, 20, 40);
  assert.equal(backingAlpha, cssAlpha);
});

test("rejects invalid feather geometry", () => {
  assert.equal(getRoundedRectFeatherAlpha({ x: 5, y: 5 }, { width: 0, height: 80 }, 10, 20), 0);
  assert.equal(getRoundedRectFeatherAlpha({ x: 5, y: 5 }, { width: 100, height: 80 }, 0, 20), 0);
});
