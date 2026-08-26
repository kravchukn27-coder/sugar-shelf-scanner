import type { SqlQueryExecutor } from "./repository";
import { APPROVED_SPAIN_PRODUCTS } from "./approved-spain";

export const EXPECTED_REVIEWED_PRODUCT_COUNT = APPROVED_SPAIN_PRODUCTS.length;

export const CATALOG_STATUS_QUERY = `
  SELECT COUNT(DISTINCT provenance.product_id)::int AS reviewed_product_count
  FROM provenance
  INNER JOIN nutrition_facts nutrition ON nutrition.product_id = provenance.product_id
  WHERE provenance.source = 'curated'`;

export type DatabaseCatalogStatus =
  | { state: "not_configured"; reviewedProductCount: 0; expectedReviewedProductCount: number; importComplete: false }
  | { state: "ready"; reviewedProductCount: number; expectedReviewedProductCount: number; importComplete: boolean }
  | { state: "not_ready"; reviewedProductCount: 0; expectedReviewedProductCount: number; importComplete: false }
  | { state: "unavailable"; reviewedProductCount: 0; expectedReviewedProductCount: number; importComplete: false };

/**
 * Operational status only: it deliberately contains no connection string,
 * device data, or scan data. A product is counted only when its reviewed
 * provenance and nutrition are both present, which proves a usable import.
 */
export async function getDatabaseCatalogStatus(
  databaseUrl: string | undefined,
  db: SqlQueryExecutor | undefined,
): Promise<DatabaseCatalogStatus> {
  if (!databaseUrl && !db) return {
    state: "not_configured",
    reviewedProductCount: 0,
    expectedReviewedProductCount: EXPECTED_REVIEWED_PRODUCT_COUNT,
    importComplete: false,
  };

  try {
    const result = await (db as SqlQueryExecutor).query<{ reviewed_product_count: number | string }>(CATALOG_STATUS_QUERY);
    const value = Number(result.rows[0]?.reviewed_product_count ?? 0);
    const reviewedProductCount = Number.isFinite(value) && value > 0 ? value : 0;
    return reviewedProductCount > 0
      ? {
        state: "ready",
        reviewedProductCount,
        expectedReviewedProductCount: EXPECTED_REVIEWED_PRODUCT_COUNT,
        importComplete: reviewedProductCount >= EXPECTED_REVIEWED_PRODUCT_COUNT,
      }
      : {
        state: "not_ready",
        reviewedProductCount: 0,
        expectedReviewedProductCount: EXPECTED_REVIEWED_PRODUCT_COUNT,
        importComplete: false,
      };
  } catch {
    // A missing migration and a transient connection failure are both unsafe
    // to treat as catalog availability. Keep the public health endpoint alive.
    return {
      state: "unavailable",
      reviewedProductCount: 0,
      expectedReviewedProductCount: EXPECTED_REVIEWED_PRODUCT_COUNT,
      importComplete: false,
    };
  }
}
