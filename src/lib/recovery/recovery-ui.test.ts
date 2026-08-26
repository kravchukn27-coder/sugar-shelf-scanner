import assert from "node:assert/strict";
import test from "node:test";
import { shouldOfferBarcodeRecovery } from "./recovery-ui";

test("recovery is shown only in open Details for estimate or unknown products", () => {
  assert.equal(shouldOfferBarcodeRecovery("estimate", true), true);
  assert.equal(shouldOfferBarcodeRecovery("unknown", true), true);
  assert.equal(shouldOfferBarcodeRecovery("confirmed", true), false);
  // This protects the default screen from growing a separate barcode button.
  assert.equal(shouldOfferBarcodeRecovery("estimate", false), false);
});
