import assert from "node:assert/strict";
import test from "node:test";
import { metaPixelId } from "./meta-pixel";

test("accepts a trimmed numeric Meta Pixel ID", () => {
  assert.equal(metaPixelId(" 1035356344859590 "), "1035356344859590");
});

test("keeps tracking disabled for absent or malformed IDs", () => {
  assert.equal(metaPixelId(undefined), null);
  assert.equal(metaPixelId(""), null);
  assert.equal(metaPixelId("pixel-id"), null);
});
