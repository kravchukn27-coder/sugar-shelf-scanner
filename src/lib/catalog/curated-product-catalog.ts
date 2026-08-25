import type { CatalogFeedback, CatalogMatch, CatalogProduct, ProductCatalogProvider, VisualCandidate } from "./types";

const WORD_PATTERN = /[a-z0-9]+/g;

function tokens(value: string | null): Set<string> {
  return new Set((value?.toLowerCase().match(WORD_PATTERN) ?? []).filter((token) => token.length > 1));
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function candidateScore(product: CatalogProduct, candidate: VisualCandidate): number {
  const brand = overlap(tokens(product.brand), tokens(candidate.brand));
  const name = overlap(tokens(product.name), tokens(candidate.name));
  const packSize = overlap(tokens(product.packSize), tokens(candidate.packSize));
  // A brand on pack is stronger than generic product-name words on a shelf.
  return brand * 0.55 + name * 0.4 + packSize * 0.05;
}

export class CuratedProductCatalog implements ProductCatalogProvider {
  private readonly productsById: Map<string, CatalogProduct>;
  private readonly productsByGtin: Map<string, CatalogProduct>;

  public constructor(products: readonly CatalogProduct[]) {
    this.productsById = new Map(products.map((item) => [item.id, item]));
    this.productsByGtin = new Map(products.flatMap((item) => (item.gtin ? [[item.gtin, item] as const] : [])));
  }

  public async lookupBarcode(gtin: string): Promise<CatalogProduct | null> {
    return this.productsByGtin.get(gtin.replace(/[^0-9]/g, "")) ?? null;
  }

  public async searchCandidates(candidate: VisualCandidate, limit = 3): Promise<CatalogMatch[]> {
    return [...this.productsById.values()]
      .map((product) => ({ product, confidence: candidateScore(product, candidate) }))
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence || a.product.id.localeCompare(b.product.id))
      .slice(0, Math.max(0, limit));
  }

  public async getProduct(id: string): Promise<CatalogProduct | null> {
    return this.productsById.get(id) ?? null;
  }

  // Persistence belongs to a future feedback provider; the curated demo is intentionally no-op.
  public async recordFeedback(_feedback: CatalogFeedback): Promise<void> {}
}
