import assert from "node:assert/strict";
import test from "node:test";
import { getCenteredFrameCrop, getObjectFitCoverTransform, mapAnalyzedBoxToPreview } from "./frame-crop";

test("uses a detached upload's natural aspect ratio instead of its empty layout box", () => {
  const crop = getCenteredFrameCrop(4032, 3024, 0, 0);

  assert.deepEqual(crop, { aspect: 4 / 3, sx: 0, sy: 0, sw: 4032, sh: 3024 });
});

test("applies a modest centred digital crop without changing the output aspect", () => {
  const crop = getCenteredFrameCrop(1920, 1080, 390, 844, 1.12);

  assert.ok(crop);
  assert.equal(crop.aspect, 390 / 844);
  assert.ok(crop.sw < 1920);
  assert.ok(crop.sh < 1080);
  assert.equal(crop.sx, (1920 - crop.sw) / 2);
  assert.equal(crop.sy, (1080 - crop.sh) / 2);
});

test("maps portrait upload boxes from the analyzed crop into a 359×782 cover preview", () => {
  const source = { width: 3024, height: 4032 };
  const preview = { width: 359, height: 782 };
  const crop = getCenteredFrameCrop(source.width, source.height, preview.width, preview.height, 1.12);
  assert.ok(crop);

  // Two packages at different positions in the same portrait upload. Their
  // source boxes come from Gemini's normalized coordinates in `crop`, not the
  // full source image.
  const leftProduct = mapAnalyzedBoxToPreview({ x: .05, y: .18, width: .28, height: .55 }, crop, source, preview);
  const rightProduct = mapAnalyzedBoxToPreview({ x: .63, y: .3, width: .24, height: .48 }, crop, source, preview);

  assert.ok(leftProduct);
  assert.ok(rightProduct);
  assert.ok(leftProduct.x > 0 && leftProduct.x < rightProduct.x);
  assert.ok(leftProduct.y > 0 && leftProduct.y + leftProduct.height < 1);
  assert.ok(rightProduct.x + rightProduct.width < 1);
  assert.ok(rightProduct.y + rightProduct.height < 1);
});

test("clips an analyzed crop edge to the visible object-fit cover viewport", () => {
  const source = { width: 4032, height: 3024 };
  const preview = { width: 359, height: 782 };
  const crop = getCenteredFrameCrop(source.width, source.height, preview.width, preview.height);
  assert.ok(crop);

  const transform = getObjectFitCoverTransform(source, preview);
  assert.ok(transform);
  assert.equal(transform.renderedHeight, 782);
  assert.ok(transform.offsetX < 0);

  // This product extends into source pixels hidden by the cover crop. It must
  // stay a valid normalized overlay instead of overflowing the preview.
  const mapped = mapAnalyzedBoxToPreview({ x: 0, y: .1, width: .3, height: .4 }, crop, source, preview);
  assert.ok(mapped);
  assert.equal(mapped.x, 0);
  assert.ok(mapped.width > 0 && mapped.width < .3);
  assert.ok(mapped.y > 0 && mapped.y + mapped.height < 1);
});

test("preserves full-frame coordinates when source and preview share an aspect", () => {
  const crop = getCenteredFrameCrop(1920, 1080, 960, 540);
  assert.ok(crop);
  const box = { x: .2, y: .3, width: .4, height: .5 } as const;
  const mapped = mapAnalyzedBoxToPreview(box, crop, { width: 1920, height: 1080 }, { width: 960, height: 540 });
  assert.ok(mapped);
  for (const key of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(mapped[key] - box[key]) < 1e-12);
});
