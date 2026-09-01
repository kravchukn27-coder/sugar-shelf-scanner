import assert from "node:assert/strict";
import test from "node:test";
import { estimateGeminiCost } from "./gemini-cost";

test("estimates standard Gemini 3.6 Flash input and output costs separately", () => {
  assert.deepEqual(estimateGeminiCost("gemini-3.6-flash", {
    promptTokenCount: 1_000_000,
    candidatesTokenCount: 200_000,
    thoughtsTokenCount: 100_000,
    totalTokenCount: 1_300_000,
  }), {
    pricingVersion: "gemini-3.6-flash-standard-2026",
    inputTokens: 1_000_000,
    outputTokens: 300_000,
    estimatedCostUsd: 1.875,
  });
});

test("returns unpriced when model or directional token fields are unknown", () => {
  assert.equal(estimateGeminiCost("gemini-2.5-flash", { promptTokenCount: 1, candidatesTokenCount: 1 }), null);
  assert.equal(estimateGeminiCost("gemini-3.6-flash", { totalTokenCount: 7 }), null);
});
