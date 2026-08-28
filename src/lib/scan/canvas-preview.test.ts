import assert from "node:assert/strict";
import test from "node:test";
import {
  getCanvasBackingSize,
  getCoverCrop,
  getRoundedRectFeatherAlpha,
  shouldRenderCanvasFrame,
} from "./canvas-preview";

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

test("keeps CSS feather geometry stable across backing-store scale", () => {
  const cssAlpha = getRoundedRectFeatherAlpha({ x: 5, y: 40 }, { width: 100, height: 80 }, 10, 20);
  const scaledAlpha = getRoundedRectFeatherAlpha({ x: 10, y: 80 }, { width: 200, height: 160 }, 20, 40);
  assert.equal(scaledAlpha, cssAlpha);
});

test("rejects invalid feather geometry", () => {
  assert.equal(getRoundedRectFeatherAlpha({ x: 5, y: 5 }, { width: 0, height: 80 }, 10, 20), 0);
  assert.equal(getRoundedRectFeatherAlpha({ x: 5, y: 5 }, { width: 100, height: 80 }, 0, 20), 0);
});
