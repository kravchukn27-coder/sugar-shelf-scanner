import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_STATUS_QUERY, EXPECTED_REVIEWED_PRODUCT_COUNT, getDatabaseCatalogStatus } from "./catalog-status";
import type { SqlQueryExecutor } from "./repository";

function executor(rows: Record<string, unknown>[]): SqlQueryExecutor {
  return { async query<Row extends Record<string, unknown>>() { return { rows: rows as Row[] }; } };
}

test("catalog status is not configured without a DATABASE_URL", async () => {
  assert.deepEqual(await getDatabaseCatalogStatus(undefined, undefined), {
    state: "not_configured", reviewedProductCount: 0, expectedReviewedProductCount: EXPECTED_REVIEWED_PRODUCT_COUNT, importComplete: false,
  });
});

test("catalog status only reports ready when reviewed provenance has nutrition", async () => {
  const status = await getDatabaseCatalogStatus("postgres://example.test/catalog", executor([{ reviewed_product_count: "20" }]));
  assert.deepEqual(status, {
    state: "ready", reviewedProductCount: 20, expectedReviewedProductCount: EXPECTED_REVIEWED_PRODUCT_COUNT, importComplete: true,
  });
  assert.match(CATALOG_STATUS_QUERY, /INNER JOIN nutrition_facts/);
});

test("catalog status exposes a partial import without disabling the safe runtime fallback", async () => {
  const status = await getDatabaseCatalogStatus("postgres://example.test/catalog", executor([{ reviewed_product_count: "1" }]));
  assert.deepEqual(status, {
    state: "ready", reviewedProductCount: 1, expectedReviewedProductCount: EXPECTED_REVIEWED_PRODUCT_COUNT, importComplete: false,
  });
});

test("catalog status does not turn database failures into a false ready result", async () => {
  const unavailable: SqlQueryExecutor = { async query() { throw new Error("database unavailable"); } };
  assert.deepEqual(await getDatabaseCatalogStatus("postgres://example.test/catalog", unavailable), {
    state: "unavailable", reviewedProductCount: 0, expectedReviewedProductCount: EXPECTED_REVIEWED_PRODUCT_COUNT, importComplete: false,
  });
});
