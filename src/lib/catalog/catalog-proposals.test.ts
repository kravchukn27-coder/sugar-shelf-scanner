import assert from "node:assert/strict";
import test from "node:test";
import { catalogProposalRequestSchema, createProposalRateLimiter, PendingCatalogProposalExistsError, proposalSaveFailure, storePendingCatalogProposal } from "./catalog-proposals";

const valid = { gtin: "8411327013376", brand: "Example", name: "Example drink", packSize: "330 ml", sugarPer100g: 4.2, proteinPer100g: null, labelSeenLocally: true };

test("catalog proposals require a valid barcode, user-entered identity, and bounded nutrition", () => {
  assert.deepEqual(catalogProposalRequestSchema.parse(valid), valid);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, gtin: "not-a-code" }).success, false);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, gtin: "8411327013377" }).success, false);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, brand: "" }).success, false);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, sugarPer100g: 101 }).success, false);
});

test("proposal rate limiter is bounded per requester and window", () => {
  const allow = createProposalRateLimiter(2, 1000);
  assert.equal(allow("visitor", 0), true);
  assert.equal(allow("visitor", 1), true);
  assert.equal(allow("visitor", 2), false);
  assert.equal(allow("visitor", 1001), true);
});

test("proposal storage only inserts a pending review record", async () => {
  let sql = "";
  let parameters: readonly unknown[] = [];
  const id = await storePendingCatalogProposal({ query: async <Row extends Record<string, unknown>>(query: string, values?: readonly unknown[]) => { sql = query; parameters = values ?? []; return { rows: [{ id: "e25bd8fc-bb0d-4c4d-a35a-fb7c4404e336" }] as unknown as Row[] }; } }, valid);
  assert.equal(id, "e25bd8fc-bb0d-4c4d-a35a-fb7c4404e336");
  assert.match(sql, /'pending_review'/);
  assert.equal(sql.includes("products"), false);
  assert.deepEqual(parameters, ["8411327013376", "Example", "Example drink", "330 ml", 4.2, null, true]);
});

test("a duplicate pending GTIN becomes a safe idempotency outcome", async () => {
  await assert.rejects(
    storePendingCatalogProposal({ query: async () => { const error = Object.assign(new Error("duplicate"), { code: "23505" }); throw error; } }, valid),
    PendingCatalogProposalExistsError,
  );
  assert.deepEqual(proposalSaveFailure(new PendingCatalogProposalExistsError()), { status: 409, message: "This barcode is already waiting for curator review." });
  assert.equal(proposalSaveFailure(new Error("database unavailable")).status, 503);
});
