import type { ScoreBand, SugarScore } from "@/lib/contracts/product";

export const SUGAR_SCORE_THRESHOLDS = {
  greenMax: 5,
  yellowMax: 12,
  orangeMax: 22.5,
} as const;

export function getSugarScoreBand(sugarPer100g: number | null | undefined): ScoreBand {
  if (sugarPer100g === null || sugarPer100g === undefined || !Number.isFinite(sugarPer100g) || sugarPer100g < 0) {
    return "unknown";
  }

  if (sugarPer100g <= SUGAR_SCORE_THRESHOLDS.greenMax) return "green";
  if (sugarPer100g <= SUGAR_SCORE_THRESHOLDS.yellowMax) return "yellow";
  if (sugarPer100g <= SUGAR_SCORE_THRESHOLDS.orangeMax) return "orange";
  return "red";
}

export function createSugarScore(
  sugarPer100g: number | null | undefined,
  source: SugarScore["source"],
): SugarScore {
  const normalizedSugar = typeof sugarPer100g === "number" && Number.isFinite(sugarPer100g) && sugarPer100g >= 0
    ? sugarPer100g
    : null;

  return {
    band: getSugarScoreBand(normalizedSugar),
    sugarPer100g: normalizedSugar,
    source: normalizedSugar === null ? "unavailable" : source,
  };
}
