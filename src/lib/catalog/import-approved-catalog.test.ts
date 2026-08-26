import assert from "node:assert/strict";
import test from "node:test";
import { importApprovedSpainCatalog, stableCatalogUuid } from "./import-approved-catalog";
import type { SqlQueryExecutor } from "./repository";

test("approved catalog UUIDs and import writes are deterministic", async () => {
  assert.equal(stableCatalogUuid("product:corona-extra-330ml-es"), stableCatalogUuid("product:corona-extra-330ml-es"));
  assert.notEqual(stableCatalogUuid("product:corona-extra-330ml-es"), stableCatalogUuid("product:schweppes-tonica-original-330ml-es"));
  const calls: { sql: string; parameters?: readonly unknown[] }[] = [];
  const db: SqlQueryExecutor = { async query(sql, parameters) { calls.push({ sql, parameters }); return { rows: [] }; } };

  const first = await importApprovedSpainCatalog(db, undefined, "2026-08-25T00:00:00.000Z");
  const second = await importApprovedSpainCatalog(db, undefined, "2026-08-25T00:00:00.000Z");
  assert.equal(first.imported, 19);
  assert.deepEqual(second, first);
  assert.ok(calls.every((call) => call.sql.includes("ON CONFLICT")));
  assert.ok(calls.some((call) => call.parameters?.includes("8411327013376")));
});
