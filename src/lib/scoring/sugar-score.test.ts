import assert from "node:assert/strict";
import test from "node:test";
import { createSugarScore, getSugarScoreBand } from "./sugar-score";

test("assigns the four Sugar Score bands at their inclusive thresholds", () => {
  assert.equal(getSugarScoreBand(5), "green");
  assert.equal(getSugarScoreBand(5.01), "yellow");
  assert.equal(getSugarScoreBand(12), "yellow");
  assert.equal(getSugarScoreBand(12.01), "orange");
  assert.equal(getSugarScoreBand(22.5), "orange");
  assert.equal(getSugarScoreBand(22.51), "red");
});

test("does not make a score from invalid or unavailable nutrition", () => {
  assert.deepEqual(createSugarScore(null, "catalog"), {
    band: "unknown",
    sugarPer100g: null,
    source: "unavailable",
  });
});
