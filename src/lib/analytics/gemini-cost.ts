export type GeminiUsageCounters = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

export type GeminiCostEstimate = {
  pricingVersion: "gemini-3.6-flash-standard-2026";
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

const PER_MILLION = 1_000_000;

/**
 * List prices for the configured standard Gemini 3.6 Flash model, valid until
 * 2026-12-31. This intentionally returns null for unknown models instead of
 * displaying a misleading $0.00; update this small audited table whenever the
 * Railway model or its pricing changes.
 */
export function estimateGeminiCost(model: string, usage: GeminiUsageCounters): GeminiCostEstimate | null {
  if (model !== "gemini-3.6-flash") return null;
  const inputTokens = positiveInteger(usage.promptTokenCount);
  const candidateTokens = positiveInteger(usage.candidatesTokenCount);
  const thoughtTokens = positiveInteger(usage.thoughtsTokenCount);

  // A response that reports only total tokens cannot be priced accurately by
  // direction. Keep it visible as usage, but do not invent a dollar amount.
  if (inputTokens === null || candidateTokens === null || thoughtTokens === null) return null;
  const outputTokens = candidateTokens + thoughtTokens;
  return {
    pricingVersion: "gemini-3.6-flash-standard-2026",
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens * 0.75 + outputTokens * 3.75) / PER_MILLION,
  };
}

function positiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
