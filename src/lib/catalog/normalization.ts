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
const CATALOG_TITLE_CONTEXT_TOKENS = new Set([
  "beer", "lager", "ale", "beverage", "drink", "soda", "water", "bottle", "bottles", "can", "cans",
  "mexican", "imported", "original", "regular", "extra", "food", "product",
  // Spanish package category words are useful OCR context, but are not a
  // variant. Treating them like a SKU word would make a shorter package title
  // such as "Corona Extra" miss "Corona Extra Cerveza".
  "cerveza", "cervezas", "tonica", "tonicas", "refresco", "bebida", "botella", "botellas", "lata", "latas",
]);
const UNIT_ALIASES: Record<string, NormalizedPackSize["unit"]> = {
  g: "g", gram: "g", grams: "g", kg: "g", oz: "g", lb: "g",
  ml: "ml", cl: "ml", l: "ml", litre: "ml", liter: "ml", litres: "ml", liters: "ml", "fl oz": "ml",
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
  // Keep decimal separators: generic text normalization deliberately replaces
  // punctuation, but doing that here would turn "1.55 oz" into "1 55 oz".
  const text = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/fluid ounces/g, "fl oz")
    .replace(/fluid ounce/g, "fl oz");
  const match = text.match(/(\d+(?:\.\d+)?)\s*(fl oz|oz|kg|lb|gram|grams|g|litres|liters|litre|liter|ml|cl|l|ct|count|pcs|pieces)\b/);
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
    const quantity = rawUnit === "l" || rawUnit.startsWith("lit")
      ? rawQuantity * 1000
      : rawUnit === "cl"
        ? rawQuantity * 10
        : rawUnit === "fl oz"
          ? rawQuantity * 29.5735
          : rawQuantity;
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

/**
 * Source catalogs commonly append category words to a package title (for
 * example, "Corona Extra Mexican Lager Beer"). OCR generally returns the
 * shorter, visible package name. Preserve that useful asymmetry without
 * treating a brand repeated as the name as SKU evidence.
 */
function candidateTokenCoverage(candidate: string | null | undefined, product: string | null | undefined, requireContextOnly = false): number {
  const candidateTokens = new Set(normalizedTokens(candidate));
  const productTokens = new Set(normalizedTokens(product));
  if (!candidateTokens.size || !productTokens.size) return 0;
  // A catalog may append a product category to the title, but a missing
  // flavour/variant (such as "Cherry") is not safe to infer from a shorter
  // vision result.
  if (requireContextOnly) {
    for (const token of productTokens) {
      if (!candidateTokens.has(token) && !CATALOG_TITLE_CONTEXT_TOKENS.has(token)) return 0;
    }
  }
  let shared = 0;
  for (const token of candidateTokens) if (productTokens.has(token)) shared += 1;
  return shared / candidateTokens.size;
}

function hasDistinctSkuToken(candidate: MatchFields): boolean {
  const brandTokens = new Set(normalizedTokens(candidate.brand));
  return normalizedTokens(candidate.name).some((token) => !brandTokens.has(token));
}

function nameWithoutBrand(value: string | null | undefined, brand: string | null | undefined): string {
  const brandTokens = new Set(normalizedTokens(brand));
  return normalizedTokens(value).filter((token) => !brandTokens.has(token)).join(" ");
}

function isSpanishBeerBrandLabelAlias(candidate: MatchFields, product: MatchFields): boolean {
  const candidateBrand = normalizeText(candidate.brand);
  // A few Spanish beer labels show the brand alone as their largest readable
  // product label. This is narrowly an alias for an "Extra cerveza" catalog
  // title, not a general brand-only relaxation: it still requires a visible
  // name equal to the recognised brand and an exact pack-size match below.
  if (!candidateBrand || normalizeText(candidate.name) !== candidateBrand) return false;
  const productName = new Set(normalizedTokens(product.name));
  return productName.has("extra") && productName.has("cerveza");
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
  // The candidate is the shorter side here: accept a catalog brand/title that
  // adds descriptive words, but never use that relaxation on its own.
  const brand = Math.max(tokenSimilarity(candidate.brand, product.brand), candidateTokenCoverage(candidate.brand, product.brand));
  // Vision/OCR frequently repeats the brand in the name field. The brand has
  // its own score, so compare both the literal title and its de-duplicated
  // form. Some source titles themselves repeat an expanded brand ("Corona
  // Extra Mexican Lager Beer"), where stripping independently would hide the
  // shared SKU words.
  const candidateName = nameWithoutBrand(candidate.name, candidate.brand);
  const productName = nameWithoutBrand(product.name, product.brand);
  const titleNameScore = Math.max(
    tokenSimilarity(candidate.name, product.name),
    candidateTokenCoverage(candidate.name, product.name, true),
    tokenSimilarity(candidateName, productName),
    candidateTokenCoverage(candidateName, productName, true),
  );
  const name = isSpanishBeerBrandLabelAlias(candidate, product) ? Math.max(titleNameScore, 1) : titleNameScore;
  const flavour = tokenSimilarity(candidate.flavour, product.flavour);
  const packSize = packSimilarity(candidate.packSize, product.packSize);
  const flavourWeight = candidate.flavour && product.flavour ? 0.12 : 0;
  const packWeight = candidate.packSize && product.packSize ? 0.08 : 0;
  const coreWeight = 1 - flavourWeight - packWeight;
  const confidence = Number((brand * coreWeight * 0.45 + name * coreWeight * 0.55 + flavour * flavourWeight + packSize * packWeight).toFixed(3));
  // If both sides expose a package size, it is SKU evidence rather than a
  // weak preference. A different can/bottle size must not confirm nutrition
  // for the wrong product, while equivalent units (33 cl / 330 ml) normalize
  // to an exact match above.
  const hasCompatiblePackSize = !candidate.packSize || !product.packSize || packSize === 1;
  const hasSkuEvidence = hasDistinctSkuToken(candidate) || (isSpanishBeerBrandLabelAlias(candidate, product) && packSize === 1);
  const decision = !hasCompatiblePackSize
    ? "no_match"
    : brand > 0 && hasSkuEvidence && name >= 0.6 && confidence >= CATALOG_CONFIRM_THRESHOLD
      ? "confirmed"
      : confidence >= CATALOG_REVIEW_THRESHOLD
        ? "review"
        : "no_match";
  return { confidence, brand, name, flavour, packSize, decision };
}

export function normalizeSearchText(fields: MatchFields): string {
  return [fields.brand, fields.name, fields.flavour, fields.packSize].map(normalizeText).filter(Boolean).join(" ");
}
