import assert from "node:assert/strict";
import test from "node:test";
import { normalizePackSize, normalizeSearchText, scoreCatalogMatch } from "./normalization";

test("normalizes accented product text and searchable fields", () => {
  assert.equal(normalizeSearchText({ brand: "Schweppes", name: "Tónica Original", flavour: "Limón" }), "schweppes tonica original limon");
});

test("normalizes common pack-size units", () => {
  assert.deepEqual(normalizePackSize("12 fl oz"), { quantity: 354.882, unit: "ml" });
  assert.deepEqual(normalizePackSize("1.55 oz"), { quantity: 43.941725, unit: "g" });
});

test("confirms only a strong brand and SKU-name match", () => {
  const result = scoreCatalogMatch(
    { brand: "Schweppes", name: "Tonica Original", flavour: "Original", packSize: "330 ml" },
    { brand: "Schweppes", name: "Tónica Original", flavour: "Original", packSize: "330ml" },
  );
  assert.equal(result.decision, "confirmed");
});

test("confirms a short visible Corona SKU name against a longer catalog title", () => {
  const result = scoreCatalogMatch(
    { brand: "Corona", name: "Corona Extra", packSize: "355 ml" },
    { brand: "Corona Extra", name: "Corona Extra Mexican Lager Beer", packSize: "12 fl oz" },
  );
  assert.equal(result.brand, 1);
  assert.equal(result.name, 1);
  assert.equal(result.packSize, 1);
  assert.equal(result.decision, "confirmed");
});

test("does not confirm when a candidate repeats its brand as the SKU name", () => {
  const result = scoreCatalogMatch(
    { brand: "Corona", name: "Corona", packSize: "355 ml" },
    { brand: "Corona", name: "Corona Extra Mexican Lager Beer", packSize: "12 fl oz" },
  );
  assert.notEqual(result.decision, "confirmed");
});

test("does not confirm a shorter but different SKU from the same brand", () => {
  const result = scoreCatalogMatch(
    { brand: "Coca-Cola", name: "Zero Sugar", packSize: "330 ml" },
    { brand: "Coca-Cola", name: "Cherry Zero Sugar", packSize: "330 ml" },
  );
  assert.notEqual(result.decision, "confirmed");
});

test("does not confirm a brand-only match", () => {
  const result = scoreCatalogMatch({ brand: "Coca Cola", name: null }, { brand: "Coca-Cola", name: "Zero Sugar" });
  assert.notEqual(result.decision, "confirmed");
});
