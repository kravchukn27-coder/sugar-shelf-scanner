import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeCatalog } from "./runtime-catalog";
import type { SqlQueryExecutor } from "./repository";

const coronaCandidate = { brand: "Corona", name: "Corona Extra cerveza", packSize: "330 ml", confidence: 0.96 };

function executor(responses: (sql: string) => Record<string, unknown>[]): SqlQueryExecutor {
  return {
    async query<Row extends Record<string, unknown>>(sql: string) {
      return { rows: responses(sql) as Row[] };
    },
  };
}

test("DATABASE_URL is ignored until PostgreSQL has reviewed curated data", async () => {
  const catalog = await createRuntimeCatalog({
    databaseUrl: "postgres://not-used.example/catalog",
    executor: executor((sql) => sql.includes("has_reviewed_products") ? [{ has_reviewed_products: false }] : []),
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });

  const [match] = await catalog.searchCandidates(coronaCandidate, 1);
  assert.equal(match?.product.id, "corona-extra-330ml-es");
  assert.equal(match?.product.score.sugarPer100g, 0.2);
});

test("reviewed PostgreSQL is primary before the local seed and public sources", async () => {
  const catalog = await createRuntimeCatalog({
    executor: executor((sql) => {
      if (sql.includes("has_reviewed_products")) return [{ has_reviewed_products: true }];
      if (sql.includes("normalized_search_text %")) return [{
        id: "11111111-1111-5111-8111-111111111111",
        gtin: "8411327013376",
        canonical_brand: "Corona",
        canonical_name: "Extra, cerveza lager",
        canonical_flavour: null,
        canonical_pack_size: "330 ml",
        image_url: null,
        sugar_per_100g: "0.2",
        protein_per_100g: "0.3",
        nutrition_source: "curated",
        source_record_id: "corona-extra-330ml-es",
        observed_at: "2026-08-25T00:00:00.000Z",
        verified_at: "2026-08-25T00:00:00.000Z",
      }];
      return [];
    }),
  });

  const [match] = await catalog.searchCandidates(coronaCandidate, 1);
  assert.equal(match?.product.id, "11111111-1111-5111-8111-111111111111");
  assert.equal(match?.product.score.sugarPer100g, 0.2);
});

test("a PostgreSQL availability failure falls through to the approved seed", async () => {
  const catalog = await createRuntimeCatalog({
    executor: executor((sql) => {
      if (sql.includes("has_reviewed_products")) return [{ has_reviewed_products: true }];
      throw new Error("database unavailable");
    }),
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });

  const [match] = await catalog.searchCandidates(coronaCandidate, 1);
  assert.equal(match?.product.id, "corona-extra-330ml-es");
});
