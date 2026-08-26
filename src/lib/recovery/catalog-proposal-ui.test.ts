import assert from "node:assert/strict";
import test from "node:test";
import { catalogProposalErrorMessage, catalogProposalSubmissionOutcome, GENERIC_PROPOSAL_ERROR_MESSAGE } from "./catalog-proposal-ui";

test("proposal UI distinguishes an existing pending barcode from a save failure", () => {
  assert.equal(catalogProposalSubmissionOutcome(201), "saved");
  assert.equal(catalogProposalSubmissionOutcome(409), "duplicate");
  assert.equal(catalogProposalSubmissionOutcome(429), "error");
  assert.equal(catalogProposalSubmissionOutcome(503), "error");
});

test("proposal error message surfaces the server's specific reason", async () => {
  const response = new Response(JSON.stringify({ error: "Too many suggestions. Please try again later." }), { status: 429 });
  assert.equal(await catalogProposalErrorMessage(response), "Too many suggestions. Please try again later.");
});

test("proposal error message falls back to generic copy for a duplicate body with no error field", async () => {
  const response = new Response(JSON.stringify({ outcome: "already_pending_review", status: "pending_review" }), { status: 409 });
  assert.equal(await catalogProposalErrorMessage(response), GENERIC_PROPOSAL_ERROR_MESSAGE);
});

test("proposal error message falls back to generic copy for a non-JSON body", async () => {
  const response = new Response("not json", { status: 502 });
  assert.equal(await catalogProposalErrorMessage(response), GENERIC_PROPOSAL_ERROR_MESSAGE);
});
