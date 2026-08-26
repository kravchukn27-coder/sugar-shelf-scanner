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

test("reports 'decoded' when the WASM reader finds a valid barcode", async () => {
  const nativeDecoder = { detect: async () => [] };
  const wasmReader = { read: async () => [{ text: "8411327013376", isValid: true }] };
  const outcomes: string[] = [];
  const result = await decodeLocalBarcode(new Blob(["local photo"]), nativeDecoder, wasmReader, (outcome) => outcomes.push(outcome));
  assert.equal(result, "8411327013376");
  assert.deepEqual(outcomes, ["decoded"]);
});

test("reports 'not_recognised' when a decode attempt ran but found nothing", async () => {
  const nativeDecoder = { detect: async () => [] };
  const wasmReader = { read: async () => [] };
  const outcomes: string[] = [];
  const result = await decodeLocalBarcode({} as ImageBitmapSource, nativeDecoder, wasmReader, (outcome) => outcomes.push(outcome));
  assert.equal(result, null);
  assert.deepEqual(outcomes, ["not_recognised"]);
});

test("reports 'not_recognised' when WASM fails but native detection genuinely ran", async () => {
  const nativeDecoder = { detect: async () => [] };
  const wasmReader = { read: async () => { throw new Error("wasm init failed"); } };
  const outcomes: string[] = [];
  const result = await decodeLocalBarcode({} as ImageBitmapSource, nativeDecoder, wasmReader, (outcome) => outcomes.push(outcome));
  assert.equal(result, null);
  assert.deepEqual(outcomes, ["not_recognised"]);
});

test("reports 'reader_unavailable' when neither WASM nor native detector could run", async () => {
  const nativeDecoder = { detect: async () => { throw new Error("native detect failed"); } };
  const wasmReader = { read: async () => { throw new Error("wasm init failed"); } };
  const outcomes: string[] = [];
  const result = await decodeLocalBarcode({} as ImageBitmapSource, nativeDecoder, wasmReader, (outcome) => outcomes.push(outcome));
  assert.equal(result, null);
  assert.deepEqual(outcomes, ["reader_unavailable"]);
});

test("reports 'reader_unavailable' when WASM fails and there is no native detector", async () => {
  const wasmReader = { read: async () => { throw new Error("wasm init failed"); } };
  const outcomes: string[] = [];
  const result = await decodeLocalBarcode(new Blob(["local photo"]), null, wasmReader, (outcome) => outcomes.push(outcome));
  assert.equal(result, null);
  assert.deepEqual(outcomes, ["reader_unavailable"]);
});

test("decodeLocalBarcode remains callable without the outcome callback", async () => {
  const nativeDecoder = { detect: async () => [{ rawValue: "036000291452" }] };
  const wasmReader = { read: async () => [] };
  const result = await decodeLocalBarcode({} as ImageBitmapSource, nativeDecoder, wasmReader);
  assert.equal(result, "036000291452");
});
