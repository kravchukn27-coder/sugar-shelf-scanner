import type { LocalBarcodeDecodeOutcome } from "./local-recovery";

const RECOVERY_METRICS_URL = "/api/scan/recovery-metrics";

/**
 * Best-effort, aggregate-only browser telemetry for local barcode decoding.
 * This must never affect recovery if browser telemetry is unavailable.
 */
export function reportLocalBarcodeDecode(enabled: boolean, localBarcodeDecode: LocalBarcodeDecodeOutcome): void {
  if (!enabled) return;

  try {
    const body = JSON.stringify({ localBarcodeDecode });
    const beaconSent = typeof navigator.sendBeacon === "function"
      && navigator.sendBeacon(RECOVERY_METRICS_URL, new Blob([body], { type: "application/json" }));

    if (!beaconSent) {
      void fetch(RECOVERY_METRICS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Metrics are deliberately non-blocking and must never disrupt recovery.
  }
}
