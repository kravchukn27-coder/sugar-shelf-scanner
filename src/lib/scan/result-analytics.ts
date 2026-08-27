import type { Detection } from "@/lib/contracts/scan";
import { groupRepeatedDetections } from "@/lib/scan/deduplicate-detections";

/**
 * Coarse, privacy-safe description of the quality of a completed scan.
 *
 * These values deliberately describe the displayed composition rather than
 * individual products, preserving whether a result mixes confidence levels.
 */
export type ScanResultQualityBucket =
  | "no_detection"
  | "unknown_only"
  | "estimate_only"
  | "confirmed_only"
  | "mixed";

/** A capped bucket avoids logging an exact shelf/product count. */
export type ScanResultGroupCountBucket = "0" | "1" | "2_5" | "6_plus";

/**
 * The complete payload permitted for a result-shown analytics event.
 * It intentionally has no product, detection, scan, frame, or user identity.
 */
export interface ScanResultAnalytics {
  resultQuality: ScanResultQualityBucket;
  detectionCountBucket: ScanResultGroupCountBucket;
}

function qualityBucket(detections: readonly Detection[]): ScanResultQualityBucket {
  if (detections.length === 0) return "no_detection";
  const statuses = new Set(detections.map((detection) => detection.status));
  if (statuses.size > 1) return "mixed";
  if (statuses.has("confirmed")) return "confirmed_only";
  if (statuses.has("estimate")) return "estimate_only";
  return "unknown_only";
}

function groupCountBucket(groupCount: number): ScanResultGroupCountBucket {
  if (groupCount === 0) return "0";
  if (groupCount === 1) return "1";
  if (groupCount <= 5) return "2_5";
  return "6_plus";
}

/**
 * Classifies a final scan into a fixed allowlist of aggregate values.
 *
 * Duplicate package detections are grouped with the same rule the result UI
 * uses, so the count represents unique displayed product groups. The returned
 * object never retains any input object or identity-bearing field.
 */
export function classifyScanResultAnalytics(detections: readonly Detection[]): ScanResultAnalytics {
  return {
    resultQuality: qualityBucket(detections),
    detectionCountBucket: groupCountBucket(groupRepeatedDetections(detections).length),
  };
}
