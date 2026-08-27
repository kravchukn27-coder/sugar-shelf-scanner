import assert from "node:assert/strict";
import test from "node:test";
import { getCanvasBackingSize, getCoverCrop, shouldRenderCanvasFrame } from "./canvas-preview";

test("creates the centred 3:4 crop of a 4:3 Safari camera frame", () => {
  assert.deepEqual(getCoverCrop({ width: 1920, height: 1440 }, { width: 402, height: 536 }), {
    sx: 420,
    sy: 0,
    sw: 1080,
    sh: 1440,
  });
});

test("turns the sharp 3:4 foreground into an enlarged portrait backdrop", () => {
  assert.deepEqual(getCoverCrop({ width: 402, height: 536 }, { width: 402, height: 714 }), {
    sx: 50.109243697479,
    sy: 0,
    sw: 301.781512605042,
    sh: 536,
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
