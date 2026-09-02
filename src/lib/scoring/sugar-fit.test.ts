import assert from "node:assert/strict";
import test from "node:test";
import { calculateSugarFit, inferProductCategory, parsePackAmount } from "./sugar-fit";

test("parses common liquid and solid package sizes", () => {
  assert.deepEqual(parsePackAmount("330 ml"), { amount: 330, kind: "liquid" });
  assert.deepEqual(parsePackAmount("33 cl"), { amount: 330, kind: "liquid" });
  assert.deepEqual(parsePackAmount("1.49 oz"), { amount: 42.240755, kind: "solid" });
});

test("gives a low-sugar 330 ml drink a good personalized prototype fit", () => {
  const result = calculateSugarFit({ sugarPer100g: .2, packSize: "330 ml", brand: "Corona", name: "Extra cerveza lager" });
  assert.ok(result);
  assert.ok(result.score >= 80);
  assert.equal(result.tone, "green");
  assert.equal(result.per100Label, "per 100 ml");
  assert.deepEqual(result.reasons[0], { label: "Low sugar impact", tone: "good" });
  assert.deepEqual(result.reasons[1], { label: "Limited nutrition data", tone: "neutral" });
});

test("gives a high-sugar can a low fit for the prototype day", () => {
  const result = calculateSugarFit({ sugarPer100g: 10.6, packSize: "330 ml", brand: "Coca-Cola", name: "Original" });
  assert.ok(result);
  assert.ok(result.score < 40);
  assert.equal(result.tone, "red");
  assert.deepEqual(result.reasons[0], { label: "Very high sugar impact", tone: "bad" });
});

test("never displays a Sugar Fit below 1", () => {
  const result = calculateSugarFit({ sugarPer100g: 100, packSize: "100 g", name: "High-sugar snack", energyKcalPer100g: 700, fatPer100g: 50 });
  assert.ok(result);
  assert.equal(result.score, 1);
  assert.equal(result.tone, "red");
});

test("uses a category penalty without flattening distinct chip nutrition into one score", () => {
  const result = calculateSugarFit({ sugarPer100g: .5, packSize: "45 g", name: "Classic Potato Chips", energyKcalPer100g: 536, fatPer100g: 35 });
  assert.ok(result);
  const lighter = calculateSugarFit({ sugarPer100g: .5, packSize: "45 g", name: "Classic Potato Chips", energyKcalPer100g: 480, fatPer100g: 24, proteinPer100g: 7 });
  assert.ok(lighter);
  assert.ok(lighter.score > result.score);
  assert.deepEqual(result.reasons[0], { label: "Low sugar impact", tone: "good" });
  assert.ok(result.reasons.some((reason) => reason.label === "High calorie density"));
  assert.ok(result.reasons.some((reason) => reason.label === "High in fat"));
  assert.ok(result.reasons.some((reason) => reason.label === "Highly processed snack"));

  const visualEstimate = calculateSugarFit({ sugarPer100g: .5, packSize: "45 g", brand: "Lay’s", name: "Original" });
  assert.ok(visualEstimate);
  assert.ok(visualEstimate.reasons.some((reason) => reason.label === "Highly processed snack"));
});

test("differentiates candy and chocolate products instead of capping them at a shared score", () => {
  const gummy = calculateSugarFit({ sugarPer100g: 50, packSize: "50 g", name: "Gummy Candy", energyKcalPer100g: 350, fatPer100g: 0, proteinPer100g: 5 });
  const caramel = calculateSugarFit({ sugarPer100g: 45, packSize: "50 g", name: "Caramel Candy", energyKcalPer100g: 430, fatPer100g: 15, proteinPer100g: 3 });
  const darkChocolate = calculateSugarFit({ sugarPer100g: 25, packSize: "40 g", name: "Dark Chocolate", energyKcalPer100g: 600, fatPer100g: 42, proteinPer100g: 8 });
  const milkChocolate = calculateSugarFit({ sugarPer100g: 52, packSize: "40 g", name: "Milk Chocolate", energyKcalPer100g: 535, fatPer100g: 30, proteinPer100g: 7 });

  assert.ok(gummy && caramel && darkChocolate && milkChocolate);
  assert.notEqual(gummy.score, caramel.score);
  assert.notEqual(darkChocolate.score, milkChocolate.score);
  assert.ok(gummy.score > caramel.score);
  assert.ok(darkChocolate.score > milkChocolate.score);
});

test("keeps unavailable sugar unscored", () => {
  assert.equal(calculateSugarFit({ sugarPer100g: null, packSize: "330 ml" }), null);
});

test("infers a concise demo category from product identity", () => {
  assert.equal(inferProductCategory({ brand: "Corona", name: "Extra cerveza lager" }), "Lager beer");
  assert.equal(inferProductCategory({ brand: "Chobani", name: "Zero Sugar Greek Yogurt" }), "Yogurt");
  assert.equal(inferProductCategory({ brand: "Lay’s", name: "Classic Potato Chips" }), "Chips");
});
