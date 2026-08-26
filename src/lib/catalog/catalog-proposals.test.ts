import assert from "node:assert/strict";
import test from "node:test";
import { catalogProposalRequestSchema, createProposalRateLimiter, PendingCatalogProposalExistsError, proposalIdentityDedupeKey, proposalSaveFailure, storePendingCatalogProposal } from "./catalog-proposals";

const valid = { gtin: "8411327013376", brand: "Example", name: "Example drink", packSize: "330 ml", energyKcal: 30, sugarPer100g: 4.2, proteinPer100g: null, fatPer100g: 0, carbohydratesPer100g: 7, labelSeenLocally: true, intakeProvenance: "user_entered" as const, labelCaptureConsented: false, nutritionFieldConfidence: null };

test("catalog proposals accept GTIN or label-first identity, with all five bounded nutrition fields", () => {
  assert.deepEqual(catalogProposalRequestSchema.parse(valid), valid);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, gtin: "not-a-code" }).success, false);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, gtin: "8411327013377" }).success, false);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, brand: "" }).success, false);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, sugarPer100g: 101 }).success, false);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, energyKcal: 2001 }).success, false);
  assert.deepEqual(catalogProposalRequestSchema.parse({ ...valid, gtin: null }).gtin, null);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, intakeProvenance: "gemini_label", labelCaptureConsented: false }).success, false);
  assert.equal(catalogProposalRequestSchema.safeParse({ ...valid, rawOcr: "do not accept this" }).success, false);
});

test("label-first dedupe key is stable across harmless identity formatting", () => {
  assert.equal(
    proposalIdentityDedupeKey({ brand: "  Café Brand ", name: "Milk  Drink", packSize: "330 ML" }),
    proposalIdentityDedupeKey({ brand: "cafe brand", name: "milk drink", packSize: "330 ml" }),
  );
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
  const persisted = await storePendingCatalogProposal({ query: async <Row extends Record<string, unknown>>(query: string, values?: readonly unknown[]) => { sql = query; parameters = values ?? []; return { rows: [{ id: "e25bd8fc-bb0d-4c4d-a35a-fb7c4404e336", status: "pending_review" }] as unknown as Row[] }; } }, valid);
  assert.deepEqual(persisted, { outcome: "created", proposalId: "e25bd8fc-bb0d-4c4d-a35a-fb7c4404e336", status: "pending_review" });
  assert.match(sql, /'pending_review'/);
  assert.match(sql, /RETURNING id, status/);
  assert.equal(sql.includes("products"), false);
  assert.deepEqual(parameters, ["8411327013376", "Example", "Example drink", "330 ml", proposalIdentityDedupeKey(valid), 30, null, 0, 7, 4.2, true, "user_entered", false, null]);
});

test("proposal storage fails closed when PostgreSQL does not return pending_review", async () => {
  await assert.rejects(
    storePendingCatalogProposal({ query: async <Row extends Record<string, unknown>>() => ({ rows: [{ id: "e25bd8fc-bb0d-4c4d-a35a-fb7c4404e336", status: "approved" }] as unknown as Row[] }) }, valid),
  );
});

test("a duplicate pending GTIN becomes a safe idempotency outcome", async () => {
  await assert.rejects(
    storePendingCatalogProposal({ query: async () => { const error = Object.assign(new Error("duplicate"), { code: "23505" }); throw error; } }, valid),
    PendingCatalogProposalExistsError,
  );
  assert.deepEqual(proposalSaveFailure(new PendingCatalogProposalExistsError()), { status: 409, message: "This product is already waiting for curator review." });
  assert.equal(proposalSaveFailure(new Error("database unavailable")).status, 503);
});
