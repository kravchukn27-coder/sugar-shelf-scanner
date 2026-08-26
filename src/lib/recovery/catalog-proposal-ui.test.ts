import assert from "node:assert/strict";
import test from "node:test";
import { catalogProposalSubmissionOutcome } from "./catalog-proposal-ui";

test("proposal UI distinguishes an existing pending barcode from a save failure", () => {
  assert.equal(catalogProposalSubmissionOutcome(201), "saved");
  assert.equal(catalogProposalSubmissionOutcome(409), "duplicate");
  assert.equal(catalogProposalSubmissionOutcome(429), "error");
  assert.equal(catalogProposalSubmissionOutcome(503), "error");
});
