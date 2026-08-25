export const CATALOG_CONFIRM_THRESHOLD = 0.88;
export const CATALOG_REVIEW_THRESHOLD = 0.64;

export interface MatchFields {
  brand?: string | null;
  name?: string | null;
  flavour?: string | null;
  packSize?: string | null;
}

export interface NormalizedPackSize {
  quantity: number;
  unit: "g" | "ml" | "count";
}

export interface MatchBreakdown {
  confidence: number;
  brand: number;
  name: number;
  flavour: number;
  packSize: number;
  decision: "confirmed" | "review" | "no_match";
}

const STOP_WORDS = new Set(["and", "the", "with", "for", "of", "a", "an", "pack", "package"]);
const UNIT_ALIASES: Record<string, NormalizedPackSize["unit"]> = {
  g: "g", gram: "g", grams: "g", kg: "g", oz: "g", lb: "g",
  ml: "ml", l: "ml", litre: "ml", liter: "ml", litres: "ml", liters: "ml", "fl oz": "ml",
  ct: "count", count: "count", pcs: "count", pieces: "count",
};

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizedTokens(value: string | null | undefined): string[] {
  return normalizeText(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function normalizePackSize(value: string | null | undefined): NormalizedPackSize | null {
  const text = normalizeText(value).replace(/fluid ounces/g, "fl oz").replace(/fluid ounce/g, "fl oz");
  const match = text.match(/(\d+(?:\.\d+)?)\s*(fl oz|oz|kg|lb|gram|grams|g|litres|liters|litre|liter|ml|l|ct|count|pcs|pieces)\b/);
  if (!match) return null;
  const rawQuantity = Number(match[1]);
  const rawUnit = match[2];
  const unit = UNIT_ALIASES[rawUnit];
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0 || !unit) return null;
  if (unit === "g") {
    const quantity = rawUnit === "kg" ? rawQuantity * 1000 : rawUnit === "lb" ? rawQuantity * 453.592 : rawUnit === "oz" ? rawQuantity * 28.3495 : rawQuantity;
    return { quantity, unit };
  }
  if (unit === "ml") {
    const quantity = rawUnit === "l" || rawUnit.startsWith("lit") ? rawQuantity * 1000 : rawUnit === "fl oz" ? rawQuantity * 29.5735 : rawQuantity;
    return { quantity, unit };
  }
  return { quantity: rawQuantity, unit };
}

function tokenSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const a = new Set(normalizedTokens(left));
  const b = new Set(normalizedTokens(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function packSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const a = normalizePackSize(left);
  const b = normalizePackSize(right);
  if (!a || !b || a.unit !== b.unit) return 0;
  const difference = Math.abs(a.quantity - b.quantity) / Math.max(a.quantity, b.quantity);
  return difference <= 0.03 ? 1 : difference <= 0.1 ? 0.6 : 0;
}

/** Pure, deterministic product ranking. A brand-only recognition can never confirm a SKU. */
export function scoreCatalogMatch(candidate: MatchFields, product: MatchFields): MatchBreakdown {
  const brand = tokenSimilarity(candidate.brand, product.brand);
  const name = tokenSimilarity(candidate.name, product.name);
  const flavour = tokenSimilarity(candidate.flavour, product.flavour);
  const packSize = packSimilarity(candidate.packSize, product.packSize);
  const flavourWeight = candidate.flavour && product.flavour ? 0.12 : 0;
  const packWeight = candidate.packSize && product.packSize ? 0.08 : 0;
  const coreWeight = 1 - flavourWeight - packWeight;
  const confidence = Number((brand * coreWeight * 0.45 + name * coreWeight * 0.55 + flavour * flavourWeight + packSize * packWeight).toFixed(3));
  const decision = brand > 0 && name >= 0.6 && confidence >= CATALOG_CONFIRM_THRESHOLD
    ? "confirmed"
    : confidence >= CATALOG_REVIEW_THRESHOLD
      ? "review"
      : "no_match";
  return { confidence, brand, name, flavour, packSize, decision };
}

export function normalizeSearchText(fields: MatchFields): string {
  return [fields.brand, fields.name, fields.flavour, fields.packSize].map(normalizeText).filter(Boolean).join(" ");
}
