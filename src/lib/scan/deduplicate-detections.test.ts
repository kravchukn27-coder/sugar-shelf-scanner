import assert from "node:assert/strict";
import test from "node:test";
import type { Detection } from "@/lib/contracts/scan";
import { groupRepeatedDetections, unionNormalizedBoxes } from "./deduplicate-detections";

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
    proteinPer100g: null,
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
    gtin: null, brand: "Brand", name: "Original", packSize: null, imageUrl: null, proteinPer100g: null,
    score: { band: "yellow" as const, sugarPer100g: 4, source: "catalog" as const },
  };
  const groups = groupRepeatedDetections([
    detection({ id: "a", status: "confirmed", product: { ...baseProduct, id: "brand-original-330" }, score: baseProduct.score }),
    detection({ id: "b", status: "confirmed", product: { ...baseProduct, id: "brand-original-500" }, score: baseProduct.score }),
  ]);
  assert.equal(groups.length, 2);
});

test("groups estimates only with equal normalized brand, name, and sugar score", () => {
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

test("does not group otherwise-identical estimates with different pack sizes", () => {
  const estimate = (id: string, packSize: string | null) => detection({
    id,
    status: "estimate",
    visualCandidate: { brand: "Corona", name: "Extra", packSize, gtin: null },
    score: { band: "green", sugarPer100g: 1.2, source: "vision_estimate" },
  });

  const groups = groupRepeatedDetections([
    estimate("330ml", "330 ml"),
    estimate("2l", "2 L"),
    estimate("missing-size", null),
  ]);

  assert.equal(groups.length, 3);
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

test("normalizes union boxes to the image bounds", () => {
  const box = unionNormalizedBoxes(
    { x: 0.8, y: 0.7, width: 0.2, height: 0.3 },
    { x: 0.9, y: 0.9, width: 0.1, height: 0.1 },
  );
  assert.deepEqual(box, { x: 0.8, y: 0.7, width: 0.2, height: 0.3 });
});
