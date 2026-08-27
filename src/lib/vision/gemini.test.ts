import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGeminiDetections } from "./gemini";

function detection(index: number) {
  return {
    box_2d: [index, index, index + 10, index + 10],
    brand: `Brand ${index}`,
    name: `Product ${index}`,
    confidence: 0.9,
  };
}

test("keeps up to twenty valid detections from an over-complete shelf response", () => {
  const result = normalizeGeminiDetections(Array.from({ length: 28 }, (_, index) => detection(index)));
  assert.equal(result.length, 20);
  assert.equal(result[0]?.visualCandidate.name, "Product 0");
  assert.equal(result[19]?.visualCandidate.name, "Product 19");
});

test("drops one malformed detection without discarding the rest of the shelf", () => {
  const result = normalizeGeminiDetections([
    detection(0),
    { ...detection(1), confidence: 9 },
    { name: "Missing box" },
    detection(3),
  ]);
  assert.deepEqual(result.map((item) => item.visualCandidate.name), ["Product 0", "Product 3"]);
});
