import { z } from "zod";
import { queueAnalyticsEvent } from "@/lib/analytics/events";

/**
 * The full browser-to-server telemetry contract. Do not add identifiers,
 * dates, request metadata, barcode values, image properties, error strings,
 * or product data: Railway stdout is an external retention surface.
 */
export const recoveryMetricsSchema = z.object({
  localBarcodeDecode: z.enum(["decoded", "not_recognised", "reader_unavailable"]),
}).strict();

export type RecoveryMetrics = z.infer<typeof recoveryMetricsSchema>;

/** This is intentionally the only payload written to stdout by metrics. */
export function logRecoveryMetrics(metric: RecoveryMetrics) {
  console.info(JSON.stringify({ event: "recovery_barcode_decode", ...metric }));
  queueAnalyticsEvent({ eventName: "recovery_barcode_decode", source: "browser", properties: metric });
}
