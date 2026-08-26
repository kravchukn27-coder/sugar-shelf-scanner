import assert from "node:assert/strict";
import test from "node:test";
import { attemptLocalNutritionOcr, decodeLocalBarcode, parseRecoveryBarcode } from "./local-recovery";

test("accepts valid EAN/UPC recovery codes and rejects malformed checksums", () => {
  assert.equal(parseRecoveryBarcode("8411327013376"), "8411327013376");
  assert.equal(parseRecoveryBarcode("0 36000 29145 2"), "036000291452");
  assert.equal(parseRecoveryBarcode("8411327013377"), null);
  assert.equal(parseRecoveryBarcode("not a barcode"), null);
});

test("uses only a valid local decoder result", async () => {
  const decoder = { detect: async () => [{ rawValue: "invalid" }, { rawValue: "8411327013376" }] };
  assert.equal(await decodeLocalBarcode({} as ImageBitmapSource, decoder), "8411327013376");
});

test("nutrition OCR reports only a local presence signal, never OCR text", async () => {
  const detector = { detect: async () => [{ rawValue: "Sugars 12 g" }] };
  assert.equal(await attemptLocalNutritionOcr({} as ImageBitmapSource, detector), true);
});
