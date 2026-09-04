export type GeminiUsageCounters = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

export type GeminiCostEstimate = {
  pricingVersion: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

const PER_MILLION = 1_000_000;

/**
 * List prices (USD per 1M tokens, paid tier, standard context) for every
 * model this app is configured to call -- confirmed against
 * https://ai.google.dev/gemini-api/docs/pricing on 2026-09-04. Returns null
 * for an unknown model instead of displaying a misleading $0.00; update this
 * small audited table whenever a Railway model or its pricing changes.
 */
const PRICING: Record<string, { version: string; inputPerMillion: number; outputPerMillion: number }> = {
  "gemini-3.6-flash": { version: "gemini-3.6-flash-standard-2026", inputPerMillion: 0.75, outputPerMillion: 3.75 },
  "gemini-3.5-flash-lite": { version: "gemini-3.5-flash-lite-standard-2026", inputPerMillion: 0.30, outputPerMillion: 2.50 },
};

export function estimateGeminiCost(model: string, usage: GeminiUsageCounters): GeminiCostEstimate | null {
  const pricing = PRICING[model];
  if (!pricing) return null;
  const inputTokens = positiveInteger(usage.promptTokenCount);
  const candidateTokens = positiveInteger(usage.candidatesTokenCount);
  const thoughtTokens = positiveInteger(usage.thoughtsTokenCount);

  // A response that reports only total tokens cannot be priced accurately by
  // direction. Keep it visible as usage, but do not invent a dollar amount.
  if (inputTokens === null || candidateTokens === null || thoughtTokens === null) return null;
  const outputTokens = candidateTokens + thoughtTokens;
  return {
    pricingVersion: pricing.version,
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / PER_MILLION,
  };
}

function positiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
