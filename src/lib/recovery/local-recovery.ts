/**
 * Local-only barcode recovery helpers. A barcode capture never leaves the
 * device: the only value that may be sent to the server is a validated GTIN.
 * A separate, explicitly-consented nutrition-label flow owns its one image
 * request and must not reuse these helpers to upload a barcode frame.
 *
 * Barcode images are decoded on-device with the lazily imported ZXing-C++ WASM
 * reader. This is the primary path because iPhone Safari does not implement
 * BarcodeDetector. The optional native detector remains only as a fallback for
 * browsers where the WASM module cannot initialise; no frame leaves the device.
 */
export type RecoveryState = "idle" | "searching" | "barcode_found" | "barcode_not_found" | "unavailable";

import { parseGtin } from "@/lib/catalog/gtin";

export interface BarcodeDetection { rawValue?: string; }
export interface LocalBarcodeDetector { detect(source: ImageBitmapSource): Promise<BarcodeDetection[]>; }
export interface LocalTextDetector { detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>; }

export interface LocalWasmBarcodeReader {
  read(source: Blob | ImageData): Promise<Array<{ text: string; format?: string; isValid?: boolean }>>;
}

type DetectorWindow = Window & {
  BarcodeDetector?: new (options?: { formats?: string[] }) => LocalBarcodeDetector;
  TextDetector?: new () => LocalTextDetector;
};

/** Validate EAN-8/EAN-13, UPC-A, and GTIN-14 before a lookup. */
export function parseRecoveryBarcode(value: string | undefined): string | null {
  return parseGtin(value);
}

export function getLocalBarcodeDetector(win: Window | undefined = typeof window === "undefined" ? undefined : window): LocalBarcodeDetector | null {
  const Detector = (win as DetectorWindow | undefined)?.BarcodeDetector;
  return Detector ? new Detector({ formats: ["ean_8", "ean_13", "upc_a", "upc_e"] }) : null;
}

export function getLocalTextDetector(win: Window | undefined = typeof window === "undefined" ? undefined : window): LocalTextDetector | null {
  const Detector = (win as DetectorWindow | undefined)?.TextDetector;
  return Detector ? new Detector() : null;
}

function isImageData(source: unknown): source is ImageData {
  return typeof ImageData !== "undefined" && source instanceof ImageData;
}

function isBlob(source: unknown): source is Blob {
  return typeof Blob !== "undefined" && source instanceof Blob;
}

/** Convert an in-memory camera frame to decoder input without serialising it. */
export function barcodeSourceToImageData(source: ImageBitmapSource): ImageData {
  if (isImageData(source)) return source;
  if (isBlob(source)) throw new Error("A Blob can be read directly by the barcode decoder.");
  const sizedSource = source as CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number };
  const width = sizedSource.videoWidth || sizedSource.width;
  const height = sizedSource.videoHeight || sizedSource.height;
  if (!width || !height) throw new Error("A captured barcode image is required.");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Barcode image cannot be read locally.");
  context.drawImage(sizedSource, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

/**
 * The reader import is intentionally inside this function: its ~1 MiB WASM
 * binary is fetched only after the user explicitly takes a recovery photo.
 */
export async function getLocalWasmBarcodeReader(): Promise<LocalWasmBarcodeReader> {
  const { readBarcodes } = await import("zxing-wasm/reader");
  return {
    read: (source) => readBarcodes(source, {
      formats: ["EAN8", "EAN13", "UPCA", "ITF14"],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      maxNumberOfSymbols: 4,
    }),
  };
}

/**
 * "reader_unavailable" means no decode attempt could actually run (WASM
 * failed to load/initialise and there was no usable native detector).
 * "not_recognised" means a decode attempt ran but found no valid barcode.
 * "decoded" means a valid barcode was found. This aggregate outcome carries
 * no barcode value, image, or per-request identifier.
 */
export type LocalBarcodeDecodeOutcome = "decoded" | "not_recognised" | "reader_unavailable";

export async function decodeLocalBarcode(
  source: ImageBitmapSource | Blob,
  nativeDetector: LocalBarcodeDetector | null = getLocalBarcodeDetector(),
  wasmReader: LocalWasmBarcodeReader | null = null,
  onOutcome?: (outcome: LocalBarcodeDecodeOutcome) => void,
): Promise<string | null> {
  // A decode attempt only "ran" if the reader/detector call itself completed
  // without throwing/rejecting; a caught failure means it could not be used.
  let wasmAttempted = false;
  let nativeAttempted = false;

  // WASM is always attempted before BarcodeDetector so Safari has the same
  // capability as Chromium, rather than a native-API-dependent recovery path.
  const reader = wasmReader ?? await getLocalWasmBarcodeReader().catch(() => null);
  const decoded = reader
    ? await (async () => {
      const wasmSource = isBlob(source) ? source : barcodeSourceToImageData(source);
      const results = await reader.read(wasmSource);
      wasmAttempted = true;
      return results;
    })().catch(() => [])
    : [];
  const validWasmCode = decoded
    .filter((result) => result.isValid !== false)
    .map((result) => parseRecoveryBarcode(result.text))
    .find((value): value is string => value !== null);
  if (validWasmCode) {
    onOutcome?.("decoded");
    return validWasmCode;
  }

  if (!nativeDetector || isBlob(source)) {
    onOutcome?.(wasmAttempted ? "not_recognised" : "reader_unavailable");
    return null;
  }
  const nativeDetections = await (async () => {
    const results = await nativeDetector.detect(source);
    nativeAttempted = true;
    return results;
  })().catch(() => []);
  const validNativeCode = nativeDetections.map((item) => parseRecoveryBarcode(item.rawValue)).find((value): value is string => value !== null) ?? null;
  if (validNativeCode) {
    onOutcome?.("decoded");
    return validNativeCode;
  }
  onOutcome?.(wasmAttempted || nativeAttempted ? "not_recognised" : "reader_unavailable");
  return null;
}

/** Runs browser-native OCR only. Do not return, log, or persist its text. */
export async function attemptLocalNutritionOcr(source: ImageBitmapSource, detector = getLocalTextDetector()): Promise<boolean> {
  if (!detector) return false;
  const blocks = await detector.detect(source).catch(() => []);
  // Presence is enough for UX telemetry/state; raw OCR text intentionally dies
  // in this function and is never exposed to React, fetch, or logging.
  return blocks.length > 0;
}
