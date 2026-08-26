import assert from "node:assert/strict";
import test from "node:test";
import { productSummarySchema } from "./product";

test("serializes catalog provenance without inventing a remote verification date", () => {
  const product = productSummarySchema.parse({
    id: "off-123",
    gtin: "123",
    brand: "Example",
    name: "Example drink",
    packSize: "330 ml",
    imageUrl: null,
    energyKcalPer100g: null,
    proteinPer100g: 0,
    fatPer100g: null,
    carbohydratesPer100g: null,
    score: { band: "yellow", sugarPer100g: 6, source: "catalog" },
    provenance: {
      source: "open_food_facts",
      sourceRecordId: "123",
      observedAt: "2026-08-25T10:00:00.000Z",
      lastVerifiedAt: null,
    },
  });

  assert.deepEqual(product.provenance, {
    source: "open_food_facts",
    sourceRecordId: "123",
    observedAt: "2026-08-25T10:00:00.000Z",
    lastVerifiedAt: null,
  });
});
