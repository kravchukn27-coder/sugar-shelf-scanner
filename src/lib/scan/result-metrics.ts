import type { ResultMetrics } from "@/lib/observability/result-metrics";

const RESULT_METRICS_URL = "/api/scan/result-metrics";
const ANALYTICS_INSTALLATION_KEY = "sugar:analytics-installation:v1";

function anonymousInstallationId(): string | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const existing = window.localStorage.getItem(ANALYTICS_INSTALLATION_KEY);
    if (existing && /^[a-f0-9]{32}$/i.test(existing)) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(ANALYTICS_INSTALLATION_KEY, value);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort, aggregate-only browser telemetry for the scanner result
 * funnel. Reporting must never delay, fail, or otherwise influence the
 * scanner UI when browser telemetry is unavailable.
 */
export function reportResultMetric(enabled: boolean, metric: ResultMetrics): void {
  if (!enabled) return;
  try {
    const anonymousId = anonymousInstallationId();
    const body = JSON.stringify({ metric, ...(anonymousId ? { anonymousId } : {}) });
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
