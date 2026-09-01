import type { Detection } from "@/lib/contracts/scan";
import { queueAnalyticsEvent } from "@/lib/analytics/events";

type CatalogOutcome = "confirmed" | "estimate" | "unknown";

/**
 * Privacy-safe catalog telemetry. Product names, barcodes, visual candidates,
 * and source-record IDs must never be emitted to Railway logs.
 */
export function logCatalogResolutionTelemetry(detections: readonly Detection[], durationMs: number) {
  const outcomes: Record<CatalogOutcome, number> = { confirmed: 0, estimate: 0, unknown: 0 };
  const sources: Record<string, number> = {};

  for (const detection of detections) {
    outcomes[detection.status] += 1;
    const source = detection.product?.provenance?.source;
    if (source) sources[source] = (sources[source] ?? 0) + 1;
  }

  const metric = {
    event: "catalog_resolution",
    durationMs: Math.max(0, Math.round(durationMs)),
    detections: detections.length,
    outcomes,
    sources,
  };
  console.info(JSON.stringify(metric));
  const { event: eventName, ...properties } = metric;
  queueAnalyticsEvent({ eventName, source: "server", properties });
}
