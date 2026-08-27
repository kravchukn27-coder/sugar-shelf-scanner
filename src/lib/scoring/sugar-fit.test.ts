import assert from "node:assert/strict";
import test from "node:test";
import { calculateSugarFit, inferProductCategory, parsePackAmount } from "./sugar-fit";

test("parses common liquid and solid package sizes", () => {
  assert.deepEqual(parsePackAmount("330 ml"), { amount: 330, kind: "liquid" });
  assert.deepEqual(parsePackAmount("33 cl"), { amount: 330, kind: "liquid" });
  assert.deepEqual(parsePackAmount("1.49 oz"), { amount: 42.240755, kind: "solid" });
});

test("gives a low-sugar 330 ml drink a high personalized prototype fit", () => {
  const result = calculateSugarFit({ sugarPer100g: .2, packSize: "330 ml", brand: "Corona", name: "Extra cerveza lager" });
  assert.ok(result);
  assert.ok(result.score >= 90);
  assert.equal(result.tone, "green");
  assert.equal(result.per100Label, "per 100 ml");
  assert.ok(result.reasons[0].startsWith("Less than 1 g"));
  assert.equal(result.reasons[1], "Low sugar impact");
});

test("gives a high-sugar can a low fit for the prototype day", () => {
  const result = calculateSugarFit({ sugarPer100g: 10.6, packSize: "330 ml", brand: "Coca-Cola", name: "Original" });
  assert.ok(result);
  assert.ok(result.score < 40);
  assert.equal(result.tone, "red");
  assert.equal(result.reasons[1], "Very high sugar impact");
});

test("never displays a Sugar Fit below 1", () => {
  const result = calculateSugarFit({ sugarPer100g: 100, packSize: "100 g", name: "High-sugar snack" });
  assert.ok(result);
  assert.equal(result.score, 1);
  assert.equal(result.tone, "red");
});

test("keeps unavailable sugar unscored", () => {
  assert.equal(calculateSugarFit({ sugarPer100g: null, packSize: "330 ml" }), null);
});

test("infers a concise demo category from product identity", () => {
  assert.equal(inferProductCategory({ brand: "Corona", name: "Extra cerveza lager" }), "Lager beer");
  assert.equal(inferProductCategory({ brand: "Chobani", name: "Zero Sugar Greek Yogurt" }), "Yogurt");
});
