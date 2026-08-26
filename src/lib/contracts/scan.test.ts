import assert from "node:assert/strict";
import test from "node:test";
import { barcodeRecoveryRequestSchema } from "./scan";

test("barcode recovery request rejects GTINs with an invalid check digit", () => {
  assert.equal(barcodeRecoveryRequestSchema.safeParse({ gtin: "8411327013376" }).success, true);
  assert.equal(barcodeRecoveryRequestSchema.safeParse({ gtin: "8411327013377" }).success, false);
  assert.equal(barcodeRecoveryRequestSchema.safeParse({ gtin: "not-a-barcode" }).success, false);
});
