import assert from "node:assert/strict";
import test from "node:test";
import { handleCatalogProposal } from "@/lib/catalog/catalog-proposal-handler";
import type { ProposalQueryExecutor } from "@/lib/catalog/catalog-proposals";

const proposal = {
  gtin: "8411327013376",
  brand: "Example",
  name: "Example drink",
  packSize: "330 ml",
  energyKcal: 30,
  proteinPer100g: null,
  fatPer100g: 0,
  carbohydratesPer100g: 7,
  sugarPer100g: 4.2,
  labelSeenLocally: true,
  intakeProvenance: "user_entered",
  labelCaptureConsented: false,
  nutritionFieldConfidence: null,
};

function request(body: unknown) {
  return new Request("http://localhost/api/catalog/proposals", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.25" },
    body: JSON.stringify(body),
  });
}

function poolReturning(row: { id: string; status: string }): ProposalQueryExecutor {
  return {
    query: async <Row extends Record<string, unknown>>() => ({ rows: [row] as unknown as Row[] }),
  };
}

test("proposal endpoint acknowledges only a persisted pending_review row", async () => {
  const response = await handleCatalogProposal(request(proposal), {
    databaseUrl: "postgres://example.invalid/catalog",
    pool: poolReturning({ id: "e25bd8fc-bb0d-4c4d-a35a-fb7c4404e336", status: "pending_review" }),
    allowRequest: () => true,
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    outcome: "created",
    proposalId: "e25bd8fc-bb0d-4c4d-a35a-fb7c4404e336",
    status: "pending_review",
  });
});

test("proposal endpoint reports an explicit duplicate-pending outcome without database details", async () => {
  const duplicatePool: ProposalQueryExecutor = {
    query: async () => { throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }); },
  };
  const response = await handleCatalogProposal(request(proposal), {
    databaseUrl: "postgres://example.invalid/catalog",
    pool: duplicatePool,
    allowRequest: () => true,
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { outcome: "already_pending_review", status: "pending_review" });
});

test("proposal endpoint fails closed without logging request content or database details", async () => {
  const unavailablePool: ProposalQueryExecutor = { query: async () => { throw new Error("connection refused: private provider detail"); } };
  const previousInfo = console.info;
  const logEntries: unknown[] = [];
  console.info = (...entries: unknown[]) => logEntries.push(entries);
  try {
    const response = await handleCatalogProposal(request(proposal), {
      databaseUrl: "postgres://example.invalid/catalog",
      pool: unavailablePool,
      allowRequest: () => true,
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Couldn’t save your suggestion. Please try again later." });
  } finally {
    console.info = previousInfo;
  }
  assert.deepEqual(logEntries, []);
});

test("proposal endpoint rejects raw OCR fields before any persistence attempt", async () => {
  let queried = false;
  const response = await handleCatalogProposal(request({ ...proposal, rawOcr: "private text" }), {
    databaseUrl: "postgres://example.invalid/catalog",
    pool: { query: async () => { queried = true; return { rows: [] }; } },
    allowRequest: () => true,
  });
  assert.equal(response.status, 400);
  assert.equal(queried, false);
});
