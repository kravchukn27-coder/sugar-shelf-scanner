import { z } from "zod";

export const scannerCompletionSchema = z.enum([
  "analysis_completed",
  "preflight_terminal",
  "request_failure",
]);

const bucketedTimingSchema = z.number()
  .finite()
  .int()
  .min(0)
  .max(60_000)
  .refine((value) => value % 25 === 0, "Timing must be rounded to 25ms buckets");

/**
 * The full browser-to-server telemetry contract. Do not add identifiers,
 * dates, request metadata, image properties, error strings, or product data:
 * Railway stdout is an external retention surface.
 */
export const scannerMetricsSchema = z.object({
  completion: scannerCompletionSchema,
  captureReadyMs: bucketedTimingSchema.optional(),
  captureEncodeMs: bucketedTimingSchema.optional(),
  preflightRttMs: bucketedTimingSchema.optional(),
  analyzeRttMs: bucketedTimingSchema.optional(),
  renderMs: bucketedTimingSchema.optional(),
  preflightAttempts: z.number().finite().int().min(0).max(90),
  qualitySkipped: z.number().finite().int().min(0).max(90),
}).strict();

export type ScannerMetrics = z.infer<typeof scannerMetricsSchema>;

/** This is intentionally the only payload written to stdout by metrics. */
export function logScannerMetrics(metric: ScannerMetrics) {
  console.info(JSON.stringify({ event: "scanner_completed", ...metric }));
}
