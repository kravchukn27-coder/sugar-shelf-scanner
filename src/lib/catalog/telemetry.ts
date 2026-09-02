import type { Detection } from "@/lib/contracts/scan";
import { queueAnalyticsEvent } from "@/lib/analytics/events";
import { DEFAULT_CONFIDENCE_WITH_NAME, DEFAULT_CONFIDENCE_WITHOUT_NAME } from "@/lib/vision/gemini";

type CatalogOutcome = "confirmed" | "estimate" | "unknown";

/**
 * Privacy-safe catalog telemetry. Product names, barcodes, visual candidates,
 * and source-record IDs must never be emitted to Railway logs.
 */
export function logCatalogResolutionTelemetry(detections: readonly Detection[], durationMs: number) {
  const outcomes: Record<CatalogOutcome, number> = { confirmed: 0, estimate: 0, unknown: 0 };
  const sources: Record<string, number> = {};
  // A confidence exactly equal to one of the two fallback constants means
  // Gemini didn't return its own value for this detection -- our default
  // stood in instead. Counting how often that happens is the only way to
  // tell "Gemini is genuinely confident" from "we're guessing on its
  // behalf", without logging the confidence values themselves per-detection.
  let defaultConfidenceCount = 0;

  for (const detection of detections) {
    outcomes[detection.status] += 1;
    const source = detection.product?.provenance?.source;
    if (source) sources[source] = (sources[source] ?? 0) + 1;
    if (detection.confidence === DEFAULT_CONFIDENCE_WITH_NAME || detection.confidence === DEFAULT_CONFIDENCE_WITHOUT_NAME) defaultConfidenceCount += 1;
  }

  const metric = {
    event: "catalog_resolution",
    durationMs: Math.max(0, Math.round(durationMs)),
    detections: detections.length,
    outcomes,
    sources,
    defaultConfidenceCount,
  };
  console.info(JSON.stringify(metric));
  const { event: eventName, ...properties } = metric;
  queueAnalyticsEvent({ eventName, source: "server", properties });
}
