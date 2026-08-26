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
  energy_kcal_per_100g: number | string | null;
  fat_per_100g: number | string | null;
  carbohydrates_per_100g: number | string | null;
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
    energyKcalPer100g: numberOrNull(row.energy_kcal_per_100g),
    proteinPer100g: numberOrNull(row.protein_per_100g),
    fatPer100g: numberOrNull(row.fat_per_100g),
    carbohydratesPer100g: numberOrNull(row.carbohydrates_per_100g),
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
         identifier.value AS gtin,
         n.sugar_per_100g, n.protein_per_100g, n.energy_kcal_per_100g, n.fat_per_100g,
         n.carbohydrates_per_100g, provenance.source AS nutrition_source,
         provenance.source_record_id, provenance.observed_at, provenance.verified_at
  FROM products p
  LEFT JOIN LATERAL (
    SELECT value FROM identifiers
    WHERE product_id = p.id AND type IN ('gtin', 'upc', 'ean')
    ORDER BY type LIMIT 1
  ) identifier ON true
  LEFT JOIN nutrition_facts n ON n.product_id = p.id
  LEFT JOIN provenance provenance ON provenance.id = n.provenance_id`;

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
      JOIN identifiers barcode ON barcode.product_id = p.id
      WHERE barcode.type IN ('gtin', 'upc', 'ean') AND barcode.value = $1
      LIMIT 1`, [normalized]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  /** Demo-only durable ingest for an exact, validated Open Food Facts barcode hit. */
  public async upsertOpenFoodFactsBarcode(product: CatalogProduct): Promise<void> {
    const gtin = product.gtin?.replace(/\D/g, "") ?? "";
    const sugar = product.score.sugarPer100g;
    if (!gtin || !product.name.trim() || typeof sugar !== "number" || !Number.isFinite(sugar) || sugar < 0 || sugar > 100) return;
    const observedAt = product.provenance.observedAt;
    await this.db.query(`WITH existing AS (
      SELECT i.product_id, EXISTS (SELECT 1 FROM provenance p WHERE p.product_id = i.product_id AND p.source = 'curated') AS curated
      FROM identifiers i WHERE i.type IN ('gtin', 'upc', 'ean') AND i.value = $1 LIMIT 1
    ), target AS (
      SELECT COALESCE((SELECT product_id FROM existing), gen_random_uuid()) AS product_id,
             COALESCE((SELECT curated FROM existing), false) AS curated
    ), product_write AS (
      INSERT INTO products (id, canonical_brand, canonical_name, canonical_flavour, canonical_pack_size, normalized_search_text, image_url)
      SELECT product_id, $2, $3, NULL, $4, $5, NULL FROM target WHERE NOT curated
      ON CONFLICT (id) DO UPDATE SET canonical_brand = EXCLUDED.canonical_brand, canonical_name = EXCLUDED.canonical_name,
        canonical_pack_size = EXCLUDED.canonical_pack_size, normalized_search_text = EXCLUDED.normalized_search_text, updated_at = now()
      RETURNING id
    ), identifier_write AS (
      INSERT INTO identifiers (id, product_id, type, value)
      SELECT gen_random_uuid(), product_id, 'gtin', $1 FROM target WHERE NOT curated
      ON CONFLICT (type, value) DO NOTHING
    ), provenance_write AS (
      INSERT INTO provenance (id, product_id, source, source_record_id, source_url, observed_at, verified_at)
      SELECT gen_random_uuid(), product_id, 'open_food_facts', $1, $6, $7::timestamptz, NULL FROM target WHERE NOT curated
      ON CONFLICT (product_id, source, source_record_id) DO UPDATE SET source_url = EXCLUDED.source_url, observed_at = EXCLUDED.observed_at
      RETURNING id, product_id
    ) INSERT INTO nutrition_facts (product_id, sugar_per_100g, protein_per_100g, energy_kcal_per_100g, fat_per_100g, carbohydrates_per_100g, provenance_id)
      SELECT p.product_id, $8, $9, $10, $11, $12, p.id FROM provenance_write p
      ON CONFLICT (product_id) DO UPDATE SET sugar_per_100g = EXCLUDED.sugar_per_100g, protein_per_100g = EXCLUDED.protein_per_100g,
        energy_kcal_per_100g = EXCLUDED.energy_kcal_per_100g, fat_per_100g = EXCLUDED.fat_per_100g,
        carbohydrates_per_100g = EXCLUDED.carbohydrates_per_100g, provenance_id = EXCLUDED.provenance_id`, [
      gtin, product.brand, product.name, product.packSize, normalizeSearchText({ brand: product.brand, name: product.name, packSize: product.packSize }),
      `https://world.openfoodfacts.org/product/${gtin}`, observedAt, sugar, product.proteinPer100g, product.energyKcalPer100g, product.fatPer100g, product.carbohydratesPer100g,
    ]);
  }

  public async searchCandidates(candidate: VisualCandidate, limit = 3): Promise<CatalogMatch[]> {
    const searchText = normalizeSearchText(candidate);
    if (!searchText) return [];
    const result = await this.db.query<ProductRow>(`${PRODUCT_SELECT}
      WHERE p.normalized_search_text % $1
        OR EXISTS (SELECT 1 FROM product_aliases a WHERE a.product_id = p.id AND a.normalized_alias % $1)
      ORDER BY GREATEST(similarity(p.normalized_search_text, $1), COALESCE((
        SELECT MAX(similarity(a.normalized_alias, $1)) FROM product_aliases a WHERE a.product_id = p.id
      ), 0)) DESC
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

  /** A configured but empty database is not a catalog. */
  public async hasReviewedProducts(): Promise<boolean> {
    const result = await this.db.query<{ has_reviewed_products: boolean | string }>(
      "SELECT EXISTS (SELECT 1 FROM provenance WHERE source = 'curated') AS has_reviewed_products",
    );
    const value = result.rows[0]?.has_reviewed_products;
    return value === true || value === "true";
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

/**
 * PostgreSQL is authoritative only after a reviewed import has completed.
 * A transient database failure must behave like an availability failure: the
 * deterministic curated catalog and public-source fallback remain usable.
 */
export class ReviewedDatabaseFirstCatalog implements ProductCatalogProvider {
  public constructor(
    private readonly database: PostgresCatalogRepository,
    private readonly fallback: ProductCatalogProvider,
  ) {}

  public async lookupBarcode(gtin: string): Promise<CatalogProduct | null> {
    return this.fromDatabaseOrFallback(
      () => this.database.lookupBarcode(gtin),
      () => this.fallback.lookupBarcode(gtin),
    );
  }

  public async searchCandidates(candidate: VisualCandidate, limit = 3): Promise<CatalogMatch[]> {
    try {
      const matches = await this.database.searchCandidates(candidate, limit);
      // Do not let an uncertain database text hit suppress an exact curated
      // hit or the established OFF/USDA availability fallback.
      if (matches[0]?.confidence >= 0.85) return matches;
    } catch {
      // Intentionally fall through. Scan handling must not expose DB outages.
    }
    return this.fallback.searchCandidates(candidate, limit);
  }

  public async getProduct(id: string): Promise<CatalogProduct | null> {
    return this.fromDatabaseOrFallback(
      () => this.database.getProduct(id),
      () => this.fallback.getProduct(id),
    );
  }

  public async recordFeedback(feedback: CatalogFeedback): Promise<void> {
    try {
      await this.database.recordFeedback(feedback);
    } catch {
      await this.fallback.recordFeedback(feedback);
    }
  }

  private async fromDatabaseOrFallback<T>(database: () => Promise<T | null>, fallback: () => Promise<T | null>): Promise<T | null> {
    try {
      const result = await database();
      if (result) return result;
    } catch {
      // Availability failures never mean a product does not exist.
    }
    return fallback();
  }
}
