export type SugarFitTone = "green" | "yellow" | "orange" | "red";

export interface SugarFitInput {
  sugarPer100g: number | null | undefined;
  packSize?: string | null;
  brand?: string | null;
  name?: string | null;
}

export interface SugarFitResult {
  score: number;
  tone: SugarFitTone;
  label: "Great fit for you" | "Good fit for you" | "A stretch today" | "High for you today";
  summary: string;
  reasons: string[];
  sugarPerPack: number | null;
  per100Label: "per 100 g" | "per 100 ml";
}

const PROTOTYPE_DAY = {
  sugarTargetGrams: 35,
  sugarLoggedGrams: 14,
} as const;

type PackAmount = { amount: number; kind: "liquid" | "solid" };
type Stop = readonly [value: number, score: number];

const DENSITY_STOPS: readonly Stop[] = [[0, 100], [5, 82], [12, 62], [22.5, 42], [40, 0]];
const SERVING_STOPS: readonly Stop[] = [[0, 100], [5, 85], [10, 68], [20, 40], [30, 10], [40, 0]];

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function interpolateScore(value: number, stops: readonly Stop[]): number {
  if (value <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const [rightValue, rightScore] = stops[index];
    const [leftValue, leftScore] = stops[index - 1];
    if (value <= rightValue) {
      const progress = (value - leftValue) / (rightValue - leftValue);
      return leftScore + ((rightScore - leftScore) * progress);
    }
  }
  return stops[stops.length - 1][1];
}

export function parsePackAmount(packSize: string | null | undefined): PackAmount | null {
  if (!packSize) return null;
  const normalized = packSize.toLowerCase().replace(",", ".").trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(fl\s*oz|ml|cl|l|kg|g|oz)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].replace(/\s/g, "");
  if (unit === "ml") return { amount: value, kind: "liquid" };
  if (unit === "cl") return { amount: value * 10, kind: "liquid" };
  if (unit === "l") return { amount: value * 1000, kind: "liquid" };
  if (unit === "floz") return { amount: value * 29.5735, kind: "liquid" };
  if (unit === "kg") return { amount: value * 1000, kind: "solid" };
  if (unit === "oz") return { amount: value * 28.3495, kind: "solid" };
  return { amount: value, kind: "solid" };
}

function fitCopy(score: number): Pick<SugarFitResult, "tone" | "label" | "summary"> {
  if (score >= 80) return { tone: "green", label: "Great fit for you", summary: "This choice keeps you on track today." };
  if (score >= 60) return { tone: "yellow", label: "Good fit for you", summary: "This can still fit your day." };
  if (score >= 40) return { tone: "orange", label: "A stretch today", summary: "A smaller serving may fit better." };
  return { tone: "red", label: "High for you today", summary: "This would take you past today’s sugar target." };
}

function sugarImpactCopy(tone: SugarFitTone) {
  if (tone === "green") return "Low sugar impact";
  if (tone === "yellow") return "Moderate sugar impact";
  if (tone === "orange") return "High sugar impact";
  return "Very high sugar impact";
}

function formatGrams(value: number): string {
  if (value > 0 && value < 1) return "Less than 1 g";
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return `${rounded.toFixed(1).replace(/\.0$/, "")} g`;
}

export function calculateSugarFit(input: SugarFitInput): SugarFitResult | null {
  const sugar = input.sugarPer100g;
  if (typeof sugar !== "number" || !Number.isFinite(sugar) || sugar < 0) return null;

  const pack = parsePackAmount(input.packSize);
  const sugarPerPack = pack ? (sugar * pack.amount) / 100 : null;
  const servingSugar = sugarPerPack ?? sugar;
  const remaining = PROTOTYPE_DAY.sugarTargetGrams - PROTOTYPE_DAY.sugarLoggedGrams;
  const densityScore = interpolateScore(sugar, DENSITY_STOPS);
  const servingScore = interpolateScore(servingSugar, SERVING_STOPS);
  const dayScore = servingSugar <= remaining
    ? 100
    : clamp(100 - (((servingSugar - remaining) / remaining) * 150));

  // Prototype-only calibration: the public metric will be validated and tuned
  // separately. Keep this isolated from the catalog's factual sugar score.
  const score = Math.round(clamp((densityScore * .45 + servingScore * .35 + dayScore * .2) * .95));
  const copy = fitCopy(score);
  const reasons = [
    sugarPerPack === null
      ? `${formatGrams(sugar)} of sugar per 100 ${pack?.kind === "liquid" ? "ml" : "g"}`
      : `${formatGrams(sugarPerPack)} of sugar in this pack`,
    sugarImpactCopy(copy.tone),
  ];

  return {
    score,
    ...copy,
    reasons,
    sugarPerPack,
    per100Label: pack?.kind === "liquid" ? "per 100 ml" : "per 100 g",
  };
}

export function inferProductCategory(input: Pick<SugarFitInput, "brand" | "name">): string {
  const text = `${input.brand ?? ""} ${input.name ?? ""}`.toLowerCase();
  if (/cerveza|beer|lager/.test(text)) return "Lager beer";
  if (/cola|refresco|soda|fanta|schweppes/.test(text)) return "Soda";
  if (/juice|zumo|nestea|sunny delight/.test(text)) return "Juice drink";
  if (/yogurt|yoghurt/.test(text)) return "Yogurt";
  if (/chocolate/.test(text)) return "Chocolate";
  if (/cereal|cheerios/.test(text)) return "Cereal";
  if (/bar|snack|granola/.test(text)) return "Snack bar";
  return "Packaged product";
}
