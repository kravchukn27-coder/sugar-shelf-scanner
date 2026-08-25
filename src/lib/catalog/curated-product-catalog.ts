import type { CatalogFeedback, CatalogMatch, CatalogProduct, ProductCatalogProvider, VisualCandidate } from "./types";
import { scoreCatalogMatch } from "./normalization";

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
      .map((product) => ({
        product,
        confidence: scoreCatalogMatch(candidate, product).confidence,
      }))
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
