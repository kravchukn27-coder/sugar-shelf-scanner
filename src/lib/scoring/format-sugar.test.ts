import assert from "node:assert/strict";
import test from "node:test";
import { formatSugarPer100g } from "./format-sugar";

test("formats sugar values with at most one decimal place", () => {
  assert.equal(formatSugarPer100g(8.39393939393939), "8.4");
  assert.equal(formatSugarPer100g(8.34), "8.3");
  assert.equal(formatSugarPer100g(8.35), "8.4");
  assert.equal(formatSugarPer100g(0), "0");
  assert.equal(formatSugarPer100g(12), "12");
  assert.equal(formatSugarPer100g(4.04), "4");
  assert.equal(formatSugarPer100g(4.05), "4.1");
});

test("returns null for missing or invalid sugar values so callers control empty copy", () => {
  assert.equal(formatSugarPer100g(null), null);
  assert.equal(formatSugarPer100g(undefined), null);
  assert.equal(formatSugarPer100g(-0.1), null);
  assert.equal(formatSugarPer100g(Number.NaN), null);
  assert.equal(formatSugarPer100g(Number.POSITIVE_INFINITY), null);
});
