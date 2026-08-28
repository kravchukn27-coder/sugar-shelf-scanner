import assert from "node:assert/strict";
import test from "node:test";
import {
  drawCropClampedToEdge,
  getCanvasBackingSize,
  getContinuationCrop,
  getCoverCrop,
  getRoundedRectFeatherAlpha,
  shouldRenderCanvasFrame,
} from "./canvas-preview";

/**
 * A pixel source whose color depends on (x, y), so drawImage calls that
 * sample different source rectangles can be told apart by "what color did
 * this destination pixel end up as". This module never touches a real
 * canvas/DOM (see its header comment), so tests fake the 2D context instead
 * of using one.
 */
type DrawImageCall = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  globalAlpha: number;
};

function createFakeContext() {
  const calls: DrawImageCall[] = [];
  const context = {
    globalAlpha: 1,
    save() {},
    restore() {
      context.globalAlpha = 1;
    },
    drawImage(
      _image: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) {
      calls.push({ sx, sy, sw, sh, dx, dy, dw, dh, globalAlpha: context.globalAlpha });
    },
  };
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

const fakeSource = { image: {} as CanvasImageSource, width: 100, height: 80 };

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

test("feathers a corner's seam against both adjacent strips instead of one abrupt flat block", () => {
  const { context, calls } = createFakeContext();
  // A crop that overhangs the 100x80 source on every side, so all four
  // corner gaps are non-zero and wider than the feather zone (12px).
  const crop = { sx: -10, sy: -10, sw: 120, sh: 100 };
  const drawn = drawCropClampedToEdge(context, fakeSource, crop, 200, 160);
  assert.equal(drawn, true);

  // gapLeft ~= 16.67, gapTop = 16, matching drawCropClampedToEdge's math.
  const gapLeft = 200 / crop.sw * (0 - crop.sx);
  const gapTop = 160 / crop.sh * (0 - crop.sy);

  const isClose = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

  // The flat base fill: still one call spanning the whole corner rect, but
  // now sampling a small neighborhood (2x2) rather than one exact pixel.
  const baseFill = calls.filter((call) => isClose(call.dx, 0) && isClose(call.dy, 0)
    && isClose(call.dw, gapLeft) && isClose(call.dh, gapTop) && call.globalAlpha === 1);
  assert.equal(baseFill.length, 1);
  assert.ok(baseFill[0].sw > 1 && baseFill[0].sh > 1,
    "the base fill should sample more than a single flat source pixel");

  // The row (top-strip) feather: several thin vertical slices hugging the
  // corner's right edge (where the top strip's real region begins), each
  // sampling the strip's own clamped edge point (0,0) — never remapping the
  // whole row into the narrow corner — at increasing alpha as x approaches
  // the strip's real boundary.
  const rowFeatherSlices = calls
    .filter((call) => isClose(call.sx, 0) && isClose(call.sy, 0) && call.sw === 1 && call.sh === 1
      && isClose(call.dy, 0) && isClose(call.dh, gapTop) && call.globalAlpha < 1)
    .sort((a, b) => a.dx - b.dx);
  assert.ok(rowFeatherSlices.length >= 3, "expected several thin row-feather slices, not one abrupt draw");
  for (let i = 1; i < rowFeatherSlices.length; i += 1) {
    assert.ok(rowFeatherSlices[i].globalAlpha > rowFeatherSlices[i - 1].globalAlpha,
      "row-feather alpha should increase toward the strip's real boundary");
    assert.ok(rowFeatherSlices[i].dx > rowFeatherSlices[i - 1].dx);
  }
  // The last (highest-alpha) slice must sit right at the corner's right
  // edge, i.e. exactly where the real top strip begins.
  const lastRowSlice = rowFeatherSlices[rowFeatherSlices.length - 1];
  assert.ok(isClose(lastRowSlice.dx + lastRowSlice.dw, gapLeft, 1e-6));

  // The column (left-strip) feather: mirror check along y, hugging the
  // corner's bottom edge.
  const colFeatherSlices = calls
    .filter((call) => isClose(call.sx, 0) && isClose(call.sy, 0) && call.sw === 1 && call.sh === 1
      && isClose(call.dx, 0) && isClose(call.dw, gapLeft) && call.globalAlpha < 1)
    .sort((a, b) => a.dy - b.dy);
  assert.ok(colFeatherSlices.length >= 3, "expected several thin column-feather slices, not one abrupt draw");
  for (let i = 1; i < colFeatherSlices.length; i += 1) {
    assert.ok(colFeatherSlices[i].globalAlpha > colFeatherSlices[i - 1].globalAlpha,
      "column-feather alpha should increase toward the strip's real boundary");
    assert.ok(colFeatherSlices[i].dy > colFeatherSlices[i - 1].dy);
  }
  const lastColSlice = colFeatherSlices[colFeatherSlices.length - 1];
  assert.ok(isClose(lastColSlice.dy + lastColSlice.dh, gapTop, 1e-6));

  // No feather slice ever samples more than a single source pixel — there is
  // no real data past the frame's edge to remap into the corner, so nothing
  // should stretch a whole row/column across the narrow corner rect (the
  // bug in the previous attempt).
  assert.ok(![...rowFeatherSlices, ...colFeatherSlices].some((call) => call.sw > 1 || call.sh > 1));
});

test("leaves the non-corner edge-stretch strips unchanged", () => {
  const { context, calls } = createFakeContext();
  const crop = { sx: -10, sy: -10, sw: 120, sh: 100 };
  drawCropClampedToEdge(context, fakeSource, crop, 200, 160);

  const scaleX = 200 / crop.sw;
  const scaleY = 160 / crop.sh;
  const left = 0;
  const top = 0;
  const right = 100;
  const bottom = 80;
  const width = right - left;
  const height = bottom - top;
  const dx = (left - crop.sx) * scaleX;
  const dy = (top - crop.sy) * scaleY;
  const dw = width * scaleX;
  const dh = height * scaleY;
  const gapTop = dy;
  const gapLeft = dx;
  const gapBottom = 160 - (dy + dh);
  const gapRight = 200 - (dx + dw);

  // Top/bottom/left/right single-strip draws must be exactly as before: one
  // call each, sampling the full-width/height edge line.
  const isClose = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const topStrip = calls.filter((call) => isClose(call.sx, left) && isClose(call.sy, top) && isClose(call.sw, width)
    && call.sh === 1 && isClose(call.dx, dx) && call.dy === 0 && isClose(call.dw, dw) && isClose(call.dh, gapTop));
  const bottomStrip = calls.filter((call) => isClose(call.sx, left) && isClose(call.sy, bottom - 1) && isClose(call.sw, width)
    && call.sh === 1 && isClose(call.dx, dx) && isClose(call.dy, dy + dh) && isClose(call.dw, dw) && isClose(call.dh, gapBottom));
  const leftStrip = calls.filter((call) => isClose(call.sx, left) && isClose(call.sy, top) && call.sw === 1
    && isClose(call.sh, height) && call.dx === 0 && isClose(call.dy, dy) && isClose(call.dw, gapLeft) && isClose(call.dh, dh));
  const rightStrip = calls.filter((call) => isClose(call.sx, right - 1) && isClose(call.sy, top) && call.sw === 1
    && isClose(call.sh, height) && isClose(call.dx, dx + dw) && isClose(call.dy, dy) && isClose(call.dw, gapRight) && isClose(call.dh, dh));

  assert.equal(topStrip.length, 1);
  assert.equal(bottomStrip.length, 1);
  assert.equal(leftStrip.length, 1);
  assert.equal(rightStrip.length, 1);
});

test("does not throw on a very small (1-2px) corner gap", () => {
  const { context } = createFakeContext();
  // A crop that overhangs the source by only ~1-2 destination pixels on
  // every side.
  const crop = { sx: -1, sy: -1.5, sw: 102, sh: 83 };
  assert.doesNotThrow(() => {
    const drawn = drawCropClampedToEdge(context, fakeSource, crop, 100.5, 80.75);
    assert.equal(drawn, true);
  });
});
