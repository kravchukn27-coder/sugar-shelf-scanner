import assert from "node:assert/strict";
import test from "node:test";
import type { Detection } from "@/lib/contracts/scan";
import { classifyScanResultAnalytics } from "./result-analytics";

function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: "private-detection-id",
    box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    confidence: 0.9,
    status: "unknown",
    visualCandidate: { brand: "Private brand", name: "Private product", packSize: "330 ml", gtin: "123456789012" },
    score: { band: "unknown", sugarPer100g: null, source: "unavailable" },
    product: null,
    estimateReason: null,
    ...overrides,
  };
}

test("classifies no detections and unknown-only scans without identities", () => {
  assert.deepEqual(classifyScanResultAnalytics([]), {
    resultQuality: "no_detection",
    detectionCountBucket: "0",
  });

  const analytics = classifyScanResultAnalytics([detection()]);
  assert.deepEqual(analytics, { resultQuality: "unknown_only", detectionCountBucket: "1" });
  assert.equal(JSON.stringify(analytics).includes("Private"), false);
  assert.equal(JSON.stringify(analytics).includes("123456789012"), false);
});

test("uses the best available result quality across mixed statuses", () => {
  const estimate = detection({
    id: "estimate-id",
    status: "estimate",
    score: { band: "yellow", sugarPer100g: 4, source: "vision_estimate" },
  });
  const confirmed = detection({
    id: "confirmed-id",
    status: "confirmed",
    product: {
      id: "private-catalog-id",
      gtin: "123456789012",
      brand: "Private brand",
      name: "Private product",
      packSize: "330 ml",
      imageUrl: null,
      energyKcalPer100g: null,
      proteinPer100g: null,
      fatPer100g: null,
      carbohydratesPer100g: null,
      score: { band: "green", sugarPer100g: 1, source: "catalog" },
    },
    score: { band: "green", sugarPer100g: 1, source: "catalog" },
  });

  assert.equal(classifyScanResultAnalytics([estimate]).resultQuality, "estimate_only");
  assert.equal(classifyScanResultAnalytics([detection(), estimate, confirmed]).resultQuality, "mixed");
});

test("buckets displayed unique groups and collapses duplicate confirmed products", () => {
  const sameProduct = {
    id: "private-catalog-id",
    gtin: "123456789012",
    brand: "Private brand",
    name: "Private product",
    packSize: "330 ml",
    imageUrl: null,
    energyKcalPer100g: null,
    proteinPer100g: null,
    fatPer100g: null,
    carbohydratesPer100g: null,
    score: { band: "green" as const, sugarPer100g: 1, source: "catalog" as const },
  };
  const confirmed = (id: string): Detection => detection({
    id,
    status: "confirmed",
    product: sameProduct,
    score: sameProduct.score,
  });

  assert.equal(classifyScanResultAnalytics([confirmed("first"), confirmed("second")]).detectionCountBucket, "1");
  assert.equal(classifyScanResultAnalytics(Array.from({ length: 5 }, (_, index) => detection({ id: `unknown-${index}` }))).detectionCountBucket, "2_5");
  assert.equal(classifyScanResultAnalytics(Array.from({ length: 6 }, (_, index) => detection({ id: `unknown-${index}` }))).detectionCountBucket, "6_plus");
});
