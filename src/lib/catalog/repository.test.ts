import assert from "node:assert/strict";
import test from "node:test";
import { PostgresCatalogRepository, type SqlQueryExecutor } from "./repository";

test("persists OFF barcode data only after its product write", async () => {
  let statement = "";
  const executor: SqlQueryExecutor = {
    async query(sql) { statement = sql; return { rows: [] }; },
  };
  const repository = new PostgresCatalogRepository(executor);

  await repository.upsertOpenFoodFactsBarcode({
    id: "off-5901234123457",
    gtin: "5901234123457",
    brand: "Demo",
    name: "Durable demo drink",
    packSize: "330 ml",
    imageUrl: null,
    referenceImages: [],
    energyKcalPer100g: null,
    proteinPer100g: 0.1,
    fatPer100g: null,
    carbohydratesPer100g: null,
    score: { band: "green", sugarPer100g: 4.2, source: "catalog" },
    provenance: { source: "open_food_facts", sourceRecordId: "5901234123457", observedAt: "2026-08-26T00:00:00.000Z", lastVerifiedAt: null },
  });

  assert.match(statement, /identifier_write AS \([\s\S]*?FROM product_write/);
  assert.match(statement, /provenance_write AS \([\s\S]*?FROM product_write/);
});
