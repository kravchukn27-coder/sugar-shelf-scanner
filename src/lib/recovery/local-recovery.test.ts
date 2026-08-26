import assert from "node:assert/strict";
import test from "node:test";
import { attemptLocalNutritionOcr, decodeLocalBarcode, parseRecoveryBarcode } from "./local-recovery";

test("accepts valid EAN/UPC recovery codes and rejects malformed checksums", () => {
  assert.equal(parseRecoveryBarcode("8411327013376"), "8411327013376");
  assert.equal(parseRecoveryBarcode("0 36000 29145 2"), "036000291452");
  assert.equal(parseRecoveryBarcode("8411327013377"), null);
  assert.equal(parseRecoveryBarcode("not a barcode"), null);
});

test("uses only a valid WASM decoder result before trying native BarcodeDetector", async () => {
  let nativeCalls = 0;
  const nativeDecoder = { detect: async () => { nativeCalls += 1; return [{ rawValue: "036000291452" }]; } };
  const wasmReader = { read: async () => [{ text: "invalid" }, { text: "8411327013376", isValid: true }] };
  assert.equal(await decodeLocalBarcode(new Blob(["local photo"]), nativeDecoder, wasmReader), "8411327013376");
  assert.equal(nativeCalls, 0);
});

test("falls back to native detection only after WASM has no valid barcode", async () => {
  const nativeDecoder = { detect: async () => [{ rawValue: "036000291452" }] };
  const wasmReader = { read: async () => [{ text: "8411327013377", isValid: true }] };
  assert.equal(await decodeLocalBarcode({} as ImageBitmapSource, nativeDecoder, wasmReader), "036000291452");
});

test("nutrition OCR reports only a local presence signal, never OCR text", async () => {
  const detector = { detect: async () => [{ rawValue: "Sugars 12 g" }] };
  assert.equal(await attemptLocalNutritionOcr({} as ImageBitmapSource, detector), true);
});
