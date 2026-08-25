import { createSugarScore } from "@/lib/scoring/sugar-score";
import type { CatalogFeedback, CatalogMatch, CatalogProduct, ProductCatalogProvider, VisualCandidate } from "./types";
import { normalizeSearchText, scoreCatalogMatch, type MatchFields } from "./normalization";

export interface SqlQueryExecutor {
  query<Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface CatalogRepository extends ProductCatalogProvider {}

type ProductRow = {
  id: string;
  gtin: string | null;
  canonical_brand: string | null;
  canonical_name: string;
  canonical_flavour: string | null;
  canonical_pack_size: string | null;
  image_url: string | null;
  sugar_per_100g: number | string | null;
  protein_per_100g: number | string | null;
  nutrition_source: "curated" | "open_food_facts" | "usda_food_data_central" | "commercial" | null;
  source_record_id: string | null;
  observed_at: string | null;
  verified_at: string | null;
};

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromRow(row: ProductRow): CatalogProduct {
  const sugar = numberOrNull(row.sugar_per_100g);
  return {
    id: row.id,
    gtin: row.gtin,
    brand: row.canonical_brand,
    name: row.canonical_name,
    packSize: row.canonical_pack_size,
    imageUrl: row.image_url,
    referenceImages: [],
    proteinPer100g: numberOrNull(row.protein_per_100g),
    score: createSugarScore(sugar, sugar === null ? "unavailable" : "catalog"),
    provenance: {
      source: row.nutrition_source ?? "curated",
      sourceRecordId: row.source_record_id ?? row.id,
      // `observed_at` is an import/read timestamp. Do not turn it into a
      // source verification claim when `verified_at` is absent.
      observedAt: row.observed_at ?? new Date(0).toISOString(),
      lastVerifiedAt: row.verified_at,
    },
  };
}

const PRODUCT_SELECT = `
  SELECT p.id, p.canonical_brand, p.canonical_name, p.canonical_flavour,
         p.canonical_pack_size, p.image_url,
         identifier.identifier_value AS gtin,
         n.sugar_per_100g, n.protein_per_100g, n.source AS nutrition_source,
         n.source_record_id, n.observed_at, n.verified_at
  FROM products p
  LEFT JOIN LATERAL (
    SELECT identifier_value FROM product_identifiers
    WHERE product_id = p.id AND identifier_type IN ('gtin', 'upc', 'ean')
    ORDER BY identifier_type LIMIT 1
  ) identifier ON true
  LEFT JOIN product_nutrition n ON n.product_id = p.id`;

/**
 * A PostgreSQL repository without a bundled database driver. Railway can pass
 * any pg-compatible executor; secrets and connection lifecycle stay at app setup.
 */
export class PostgresCatalogRepository implements CatalogRepository {
  public constructor(private readonly db: SqlQueryExecutor) {}

  public async lookupBarcode(gtin: string): Promise<CatalogProduct | null> {
    const normalized = gtin.replace(/\D/g, "");
    if (!normalized) return null;
    const result = await this.db.query<ProductRow>(`${PRODUCT_SELECT}
      JOIN product_identifiers barcode ON barcode.product_id = p.id
      WHERE barcode.identifier_type IN ('gtin', 'upc', 'ean') AND barcode.identifier_value = $1
      LIMIT 1`, [normalized]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  public async searchCandidates(candidate: VisualCandidate, limit = 3): Promise<CatalogMatch[]> {
    const searchText = normalizeSearchText(candidate);
    if (!searchText) return [];
    const result = await this.db.query<ProductRow>(`${PRODUCT_SELECT}
      WHERE p.normalized_search_text % $1
      ORDER BY similarity(p.normalized_search_text, $1) DESC
      LIMIT $2`, [searchText, Math.min(Math.max(limit * 4, 8), 40)]);
    return result.rows
      .map((row) => {
        const product = fromRow(row);
        const match = scoreCatalogMatch(candidate, toMatchFields(row));
        return { product, confidence: match.confidence, decision: match.decision };
      })
      .filter((match) => match.decision !== "no_match")
      .sort((left, right) => right.confidence - left.confidence || left.product.id.localeCompare(right.product.id))
      .slice(0, Math.max(0, limit))
      .map(({ product, confidence }) => ({ product, confidence }));
  }

  public async getProduct(id: string): Promise<CatalogProduct | null> {
    const result = await this.db.query<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1 LIMIT 1`, [id]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  public async recordFeedback(feedback: CatalogFeedback): Promise<void> {
    await this.db.query(`INSERT INTO scan_feedback (id, scan_id, candidate, selected_product_id, outcome)
      VALUES (gen_random_uuid(), $1, $2::jsonb, $3, $4)`, [feedback.scanId, JSON.stringify(feedback.candidate), feedback.productId, feedback.outcome]);
  }
}

function toMatchFields(row: ProductRow): MatchFields {
  return { brand: row.canonical_brand, name: row.canonical_name, flavour: row.canonical_flavour, packSize: row.canonical_pack_size };
}

export interface CatalogRepositoryFactoryOptions {
  executor?: SqlQueryExecutor;
  fallback: ProductCatalogProvider;
}

/** Keeps the current curated-demo behavior until an explicit database executor is wired in. */
export function createCatalogRepository(options: CatalogRepositoryFactoryOptions): ProductCatalogProvider {
  return options.executor ? new PostgresCatalogRepository(options.executor) : options.fallback;
}
