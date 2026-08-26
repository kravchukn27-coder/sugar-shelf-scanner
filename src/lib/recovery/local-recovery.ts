/**
 * Local-only recovery helpers. A recovery frame never leaves the device: the
 * only value that may be sent to the server is a validated barcode number.
 *
 * BarcodeDetector is deliberately used as an optional platform API instead of
 * bundling a decoder that runs a remote service. TextDetector is an equally
 * optional experimental browser API; most browsers do not expose it yet, so
 * callers must treat nutrition OCR as best-effort.
 */
export type RecoveryState = "idle" | "searching" | "barcode_found" | "unavailable";

export interface BarcodeDetection { rawValue?: string; }
export interface LocalBarcodeDetector { detect(source: ImageBitmapSource): Promise<BarcodeDetection[]>; }
export interface LocalTextDetector { detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>; }

type DetectorWindow = Window & {
  BarcodeDetector?: new (options?: { formats?: string[] }) => LocalBarcodeDetector;
  TextDetector?: new () => LocalTextDetector;
};

/** Validate EAN-8/EAN-13, UPC-A, and GTIN-14 before a lookup. */
export function parseRecoveryBarcode(value: string | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) sum += Number(digits[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1)) ? digits : null;
}

export function getLocalBarcodeDetector(win: Window | undefined = typeof window === "undefined" ? undefined : window): LocalBarcodeDetector | null {
  const Detector = (win as DetectorWindow | undefined)?.BarcodeDetector;
  return Detector ? new Detector({ formats: ["ean_8", "ean_13", "upc_a", "upc_e"] }) : null;
}

export function getLocalTextDetector(win: Window | undefined = typeof window === "undefined" ? undefined : window): LocalTextDetector | null {
  const Detector = (win as DetectorWindow | undefined)?.TextDetector;
  return Detector ? new Detector() : null;
}

export async function decodeLocalBarcode(source: ImageBitmapSource, detector = getLocalBarcodeDetector()): Promise<string | null> {
  if (!detector) return null;
  const detections = await detector.detect(source).catch(() => []);
  return detections.map((item) => parseRecoveryBarcode(item.rawValue)).find((value): value is string => value !== null) ?? null;
}

/** Runs browser-native OCR only. Do not return, log, or persist its text. */
export async function attemptLocalNutritionOcr(source: ImageBitmapSource, detector = getLocalTextDetector()): Promise<boolean> {
  if (!detector) return false;
  const blocks = await detector.detect(source).catch(() => []);
  // Presence is enough for UX telemetry/state; raw OCR text intentionally dies
  // in this function and is never exposed to React, fetch, or logging.
  return blocks.length > 0;
}
