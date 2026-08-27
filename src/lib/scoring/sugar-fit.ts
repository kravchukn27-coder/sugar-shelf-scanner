export type SugarFitTone = "green" | "yellow" | "orange" | "red";

export interface SugarFitInput {
  sugarPer100g: number | null | undefined;
  packSize?: string | null;
  brand?: string | null;
  name?: string | null;
  energyKcalPer100g?: number | null;
  proteinPer100g?: number | null;
  fatPer100g?: number | null;
  carbohydratesPer100g?: number | null;
}

export type YourFitReasonTone = "good" | "caution" | "bad" | "neutral";

export interface YourFitReason {
  label: string;
  tone: YourFitReasonTone;
}

export interface SugarFitResult {
  score: number;
  tone: SugarFitTone;
  label: "A good fit today" | "A fairly good fit today" | "A mixed fit today" | "Not your best fit today";
  summary: string;
  reasons: YourFitReason[];
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
const ENERGY_STOPS: readonly Stop[] = [[0, 100], [120, 90], [250, 70], [400, 40], [550, 15], [700, 0]];
const FAT_STOPS: readonly Stop[] = [[0, 100], [3, 90], [10, 70], [17.5, 45], [30, 15], [50, 0]];
const PROTEIN_STOPS: readonly Stop[] = [[0, 45], [5, 60], [10, 80], [20, 100]];
const CHIPS_PATTERN = /\b(chips?|crisps?|pringles|doritos|cheetos|ruffles|takis|lays|papitas?|papas?)\b|lay[’']s|patatas?\s+fritas/;

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

function fitCopy(score: number, sugarTone: SugarFitTone, nutritionPenalty: boolean): Pick<SugarFitResult, "tone" | "label" | "summary"> {
  if (score >= 80) return { tone: "green", label: "A good fit today", summary: "Low sugar impact with a more balanced nutrition profile." };
  if (score >= 60) return { tone: "yellow", label: "A fairly good fit today", summary: "This can fit your day, with a few nutrition tradeoffs." };
  if (score >= 40) return { tone: "orange", label: "A mixed fit today", summary: "Some nutrition factors bring the score down." };
  if (sugarTone === "green" && nutritionPenalty) return { tone: "red", label: "Not your best fit today", summary: "Low in sugar, but its overall nutrition profile brings the score down." };
  return { tone: "red", label: "Not your best fit today", summary: "Sugar and overall nutrition make this a tougher fit." };
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

function finiteNonNegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function productProfile(input: SugarFitInput) {
  const identity = `${input.brand ?? ""} ${input.name ?? ""}`.toLowerCase();
  const chips = CHIPS_PATTERN.test(identity);
  const processedBar = /\b(granola|snack bar|protein bar|cereal bar)\b/.test(identity);
  return { chips, processedBar, highlyProcessedSnack: chips || processedBar };
}

function nutritionScore(input: SugarFitInput) {
  const weighted: Array<{ value: number; weight: number }> = [];
  if (finiteNonNegative(input.energyKcalPer100g)) weighted.push({ value: interpolateScore(input.energyKcalPer100g, ENERGY_STOPS), weight: .45 });
  if (finiteNonNegative(input.fatPer100g)) weighted.push({ value: interpolateScore(input.fatPer100g, FAT_STOPS), weight: .35 });
  if (finiteNonNegative(input.proteinPer100g)) weighted.push({ value: interpolateScore(input.proteinPer100g, PROTEIN_STOPS), weight: .2 });
  if (weighted.length === 0) return { score: 65, hasNutritionData: false };
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  return { score: weighted.reduce((sum, item) => sum + (item.value * item.weight), 0) / totalWeight, hasNutritionData: true };
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
  const sugarScore = clamp((densityScore * .45 + servingScore * .35 + dayScore * .2) * .95, 1, 100);
  const sugarTone = sugarScore >= 80 ? "green" : sugarScore >= 60 ? "yellow" : sugarScore >= 40 ? "orange" : "red";
  const nutrition = nutritionScore(input);
  const profile = productProfile(input);
  let combinedScore = (sugarScore * .6) + (nutrition.score * .4);
  if (sugarTone === "red") combinedScore = Math.min(combinedScore, 39);
  else if (sugarTone === "orange") combinedScore = Math.min(combinedScore, 59);
  if (profile.chips) combinedScore = Math.min(combinedScore, 39);
  else if (profile.processedBar) combinedScore = Math.min(combinedScore, 59);
  const score = Math.round(clamp(combinedScore, 1, 100));
  const nutritionPenalty = nutrition.score < 60 || profile.highlyProcessedSnack;
  const copy = fitCopy(score, sugarTone, nutritionPenalty);
  const reasons: YourFitReason[] = [{ label: sugarImpactCopy(sugarTone), tone: sugarTone === "green" ? "good" : sugarTone === "yellow" ? "caution" : "bad" }];

  if (finiteNonNegative(input.energyKcalPer100g) && input.energyKcalPer100g >= 400) reasons.push({ label: "High calorie density", tone: "bad" });
  else if (finiteNonNegative(input.energyKcalPer100g) && input.energyKcalPer100g <= 120) reasons.push({ label: "Lower calorie density", tone: "good" });
  if (finiteNonNegative(input.fatPer100g) && input.fatPer100g >= 17.5) reasons.push({ label: "High in fat", tone: "bad" });
  if (finiteNonNegative(input.proteinPer100g) && input.proteinPer100g >= 10) reasons.push({ label: "Protein-rich", tone: "good" });
  if (profile.highlyProcessedSnack) reasons.push({ label: "Highly processed snack", tone: "caution" });
  if (!nutrition.hasNutritionData && !profile.highlyProcessedSnack) reasons.push({ label: "Limited nutrition data", tone: "neutral" });
  if (sugarTone !== "green" && reasons.length < 4) reasons.push({
    label: sugarPerPack === null
      ? `${formatGrams(sugar)} sugar per 100 ${pack?.kind === "liquid" ? "ml" : "g"}`
      : `${formatGrams(sugarPerPack)} sugar in this pack`,
    tone: sugarTone === "yellow" ? "caution" : "bad",
  });

  return {
    score,
    ...copy,
    reasons: reasons.slice(0, 4),
    sugarPerPack,
    per100Label: pack?.kind === "liquid" ? "per 100 ml" : "per 100 g",
  };
}

export function inferProductCategory(input: Pick<SugarFitInput, "brand" | "name">): string {
  const text = `${input.brand ?? ""} ${input.name ?? ""}`.toLowerCase();
  if (CHIPS_PATTERN.test(text)) return "Chips";
  if (/cerveza|beer|lager/.test(text)) return "Lager beer";
  if (/cola|refresco|soda|fanta|schweppes/.test(text)) return "Soda";
  if (/juice|zumo|nestea|sunny delight/.test(text)) return "Juice drink";
  if (/yogurt|yoghurt/.test(text)) return "Yogurt";
  if (/chocolate/.test(text)) return "Chocolate";
  if (/cereal|cheerios/.test(text)) return "Cereal";
  if (/bar|snack|granola/.test(text)) return "Snack bar";
  return "Packaged product";
}
