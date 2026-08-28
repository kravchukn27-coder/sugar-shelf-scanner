import assert from "node:assert/strict";
import test from "node:test";
import type { Detection } from "@/lib/contracts/scan";
import { groupRepeatedDetections, sortDetectionGroupsBySugarFit, unionNormalizedBoxes } from "./deduplicate-detections";

function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: "detection-1",
    box: { x: 0.1, y: 0.1, width: 0.2, height: 0.3 },
    confidence: 0.9,
    status: "unknown",
    visualCandidate: { brand: null, name: null, packSize: null, gtin: null },
    score: { band: "unknown", sugarPer100g: null, source: "unavailable" },
    product: null,
    estimateReason: null,
    ...overrides,
  };
}

test("groups confirmed repeats by stable catalog product id and unions their boxes", () => {
  const product = {
    id: "corona-extra-355ml",
    gtin: "7501064192055",
    brand: "Corona",
    name: "Extra",
    packSize: "355 ml",
    imageUrl: null,
    energyKcalPer100g: null,
    proteinPer100g: null,
    fatPer100g: null,
    carbohydratesPer100g: null,
    score: { band: "green" as const, sugarPer100g: 1.2, source: "catalog" as const },
  };
  const first = detection({ id: "a", status: "confirmed", product, score: product.score, box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 } });
  const second = detection({ id: "b", status: "confirmed", product, score: product.score, box: { x: 0.5, y: 0.1, width: 0.3, height: 0.6 } });

  const groups = groupRepeatedDetections([first, second]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.detection, first);
  assert.equal(groups[0]?.count, 2);
  assert.deepEqual(groups[0]?.memberIds, ["a", "b"]);
  assert.deepEqual(groups[0]?.box, { x: 0.1, y: 0.1, width: 0.7, height: 0.6 });
});

test("does not group distinct confirmed products even when their visible names match", () => {
  const baseProduct = {
    gtin: null, brand: "Brand", name: "Original", packSize: null, imageUrl: null, energyKcalPer100g: null, proteinPer100g: null, fatPer100g: null, carbohydratesPer100g: null,
    score: { band: "yellow" as const, sugarPer100g: 4, source: "catalog" as const },
  };
  const groups = groupRepeatedDetections([
    detection({ id: "a", status: "confirmed", product: { ...baseProduct, id: "brand-original-330" }, score: baseProduct.score }),
    detection({ id: "b", status: "confirmed", product: { ...baseProduct, id: "brand-original-500" }, score: baseProduct.score }),
  ]);
  assert.equal(groups.length, 2);
});

test("groups estimates with equal normalized brand/name and a close-enough sugar score", () => {
  const first = detection({
    id: "a", status: "estimate", visualCandidate: { brand: "  Corona ", name: "Extra", packSize: "330 ml", gtin: null },
    score: { band: "green", sugarPer100g: 1.2, source: "vision_estimate" },
  });
  const same = detection({
    id: "b", status: "estimate", visualCandidate: { brand: "corona", name: "EXTRA", packSize: "330 ML", gtin: null },
    score: { band: "green", sugarPer100g: 1.2, source: "vision_estimate" },
  });
  const variant = detection({
    id: "c", status: "estimate", visualCandidate: { brand: "Corona", name: "Extra Zero", packSize: "330 ml", gtin: null },
    score: { band: "green", sugarPer100g: 1.2, source: "vision_estimate" },
  });
  const differentSugar = detection({
    id: "d", status: "estimate", visualCandidate: { brand: "Corona", name: "Extra", packSize: "330 ml", gtin: null },
    score: { band: "yellow", sugarPer100g: 4.2, source: "vision_estimate" },
  });

  const groups = groupRepeatedDetections([first, same, variant, differentSugar]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0]?.memberIds, ["a", "b"]);
});

test("tolerates per-crop sugar-estimate noise within the same band (demo-priority tolerance)", () => {
  const estimate = (id: string, sugarPer100g: number) => detection({
    id, status: "estimate", visualCandidate: { brand: "Cal Vall", name: "Tomate Frito", packSize: "350 g", gtin: null },
    score: { band: "yellow", sugarPer100g, source: "vision_estimate" },
  });

  // Same physical product, four independent per-crop AI reads landing within
  // a few grams of each other (mirrors what a busy shelf actually returns).
  const groups = groupRepeatedDetections([estimate("a", 82), estimate("b", 84), estimate("c", 85), estimate("d", 87)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.count, 4);
});

test("still separates estimates whose sugar reads differ by more than the tolerance", () => {
  const estimate = (id: string, sugarPer100g: number) => detection({
    id, status: "estimate", visualCandidate: { brand: "Cal Vall", name: "Tomate Frito", packSize: "350 g", gtin: null },
    score: { band: "yellow", sugarPer100g, source: "vision_estimate" },
  });

  // 7g apart, past the 5g tolerance — same band alone must not merge them.
  const groups = groupRepeatedDetections([estimate("a", 80), estimate("b", 87)]);
  assert.equal(groups.length, 2);
});

test("does not group otherwise-identical estimates when both sides read a pack size and it differs", () => {
  const estimate = (id: string, packSize: string | null) => detection({
    id,
    status: "estimate",
    visualCandidate: { brand: "Corona", name: "Extra", packSize, gtin: null },
    score: { band: "green", sugarPer100g: 1.2, source: "vision_estimate" },
  });

  const groups = groupRepeatedDetections([
    estimate("330ml", "330 ml"),
    estimate("2l", "2 L"),
  ]);

  assert.equal(groups.length, 2);
});

test("a facing with no legible pack size still joins a group that has one (dense-shelf OCR gaps)", () => {
  // Small-print pack size routinely fails to OCR on some facings even when
  // brand/name/sugar read fine — that alone must not keep an obviously
  // identical facing permanently ungrouped.
  const estimate = (id: string, packSize: string | null) => detection({
    id,
    status: "estimate",
    visualCandidate: { brand: "Lay's", name: "Oven Baked Yoghurt With Herbs", packSize, gtin: null },
    score: { band: "green", sugarPer100g: 6, source: "vision_estimate" },
  });

  const groups = groupRepeatedDetections([
    estimate("a", "150 g"),
    estimate("b", null),
    estimate("c", null),
    estimate("d", "150 g"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.count, 4);
});

test("a missing-pack-size facing still refuses to bridge two genuinely different sizes", () => {
  const estimate = (id: string, packSize: string | null) => detection({
    id,
    status: "estimate",
    visualCandidate: { brand: "Corona", name: "Extra", packSize, gtin: null },
    score: { band: "green", sugarPer100g: 1.2, source: "vision_estimate" },
  });

  // "missing-size" matches whichever compatible group it's compared against
  // first (330ml here); it does not retroactively bridge 330ml and 2L.
  const groups = groupRepeatedDetections([
    estimate("330ml", "330 ml"),
    estimate("2l", "2 L"),
    estimate("missing-size", null),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.count).sort(), [1, 2]);
});

test("leaves unknown and incomplete estimates independent, preserves first appearance, and does not mutate inputs", () => {
  const unknownA = detection({ id: "unknown-a" });
  const incompleteA = detection({ id: "incomplete-a", status: "estimate", visualCandidate: { brand: "Brand", name: null, packSize: null, gtin: null }, score: { band: "red", sugarPer100g: 10, source: "vision_estimate" } });
  const unknownB = detection({ id: "unknown-b" });
  const snapshot = structuredClone([unknownA, incompleteA, unknownB]);

  const groups = groupRepeatedDetections([unknownA, incompleteA, unknownB]);
  assert.deepEqual(groups.map((group) => group.detection.id), ["unknown-a", "incomplete-a", "unknown-b"]);
  assert.deepEqual([unknownA, incompleteA, unknownB], snapshot);
});

test("ranks result groups from the highest Sugar Fit score to the lowest", () => {
  const groups = groupRepeatedDetections([
    detection({ id: "high-sugar", score: { band: "red", sugarPer100g: 62, source: "catalog" } }),
    detection({ id: "unknown", score: { band: "unknown", sugarPer100g: null, source: "unavailable" } }),
    detection({ id: "low-sugar", score: { band: "green", sugarPer100g: 3, source: "catalog" } }),
    detection({ id: "same-sugar", score: { band: "green", sugarPer100g: 3, source: "catalog" } }),
  ]);

  const ranked = sortDetectionGroupsBySugarFit(groups);

  assert.deepEqual(ranked.map((group) => group.detection.id), ["low-sugar", "same-sugar", "high-sugar", "unknown"]);
  assert.deepEqual(groups.map((group) => group.detection.id), ["high-sugar", "unknown", "low-sugar", "same-sugar"]);
});

test("normalizes union boxes to the image bounds", () => {
  const box = unionNormalizedBoxes(
    { x: 0.8, y: 0.7, width: 0.2, height: 0.3 },
    { x: 0.9, y: 0.9, width: 0.1, height: 0.1 },
  );
  assert.deepEqual(box, { x: 0.8, y: 0.7, width: 0.2, height: 0.3 });
});
