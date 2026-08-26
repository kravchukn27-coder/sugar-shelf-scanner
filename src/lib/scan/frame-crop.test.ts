import assert from "node:assert/strict";
import test from "node:test";
import { getCenteredFrameCrop } from "./frame-crop";

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
