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

test("estimates standard Gemini 3.5 Flash Lite input and output costs separately", () => {
  assert.deepEqual(estimateGeminiCost("gemini-3.5-flash-lite", {
    promptTokenCount: 1_000_000,
    candidatesTokenCount: 200_000,
    thoughtsTokenCount: 100_000,
    totalTokenCount: 1_300_000,
  }), {
    pricingVersion: "gemini-3.5-flash-lite-standard-2026",
    inputTokens: 1_000_000,
    outputTokens: 300_000,
    estimatedCostUsd: 1.05,
  });
});

test("returns unpriced when model or the core input/output counters are unknown", () => {
  assert.equal(estimateGeminiCost("gemini-2.5-flash", { promptTokenCount: 1, candidatesTokenCount: 1 }), null);
  assert.equal(estimateGeminiCost("gemini-3.6-flash", { totalTokenCount: 7 }), null);
});

// Confirmed against real production traffic on 2026-09-04: at thinkingLevel
// "minimal" (preflight's setting), Gemini omits thoughtsTokenCount from
// usageMetadata entirely rather than reporting 0 -- requiring it as present
// silently priced out most of preflight's traffic. A missing value means no
// thinking tokens, not an unpriceable response.
test("prices a response with no thoughtsTokenCount as zero thinking tokens, not unpriced", () => {
  assert.deepEqual(estimateGeminiCost("gemini-3.5-flash-lite", {
    promptTokenCount: 791,
    candidatesTokenCount: 44,
    totalTokenCount: 835,
  }), {
    pricingVersion: "gemini-3.5-flash-lite-standard-2026",
    inputTokens: 791,
    outputTokens: 44,
    estimatedCostUsd: (791 * 0.30 + 44 * 2.50) / 1_000_000,
  });
});
