import type { ResultMetrics } from "@/lib/observability/result-metrics";

const RESULT_METRICS_URL = "/api/scan/result-metrics";

/**
 * Best-effort, aggregate-only browser telemetry for the scanner result
 * funnel. Reporting must never delay, fail, or otherwise influence the
 * scanner UI when browser telemetry is unavailable.
 */
export function reportResultMetric(enabled: boolean, metric: ResultMetrics): void {
  if (!enabled) return;
  try {
    const body = JSON.stringify(metric);
    const beaconSent = typeof navigator !== "undefined"
      && typeof navigator.sendBeacon === "function"
      && navigator.sendBeacon(RESULT_METRICS_URL, new Blob([body], { type: "application/json" }));
    if (!beaconSent) {
      void fetch(RESULT_METRICS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Metrics are deliberately non-blocking and must never disrupt results.
  }
}
