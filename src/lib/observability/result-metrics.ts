import { z } from "zod";
import { queueAnalyticsEvent } from "@/lib/analytics/events";

export const resultQualitySchema = z.enum([
  "no_detection",
  "unknown_only",
  "estimate_only",
  "confirmed_only",
  "mixed",
]);

export const detectionCountBucketSchema = z.enum(["0", "1", "2_5", "6_plus"]);

const scanStartedSchema = z.object({ action: z.literal("scan_started") }).strict();

const resultShownSchema = z.object({
  action: z.literal("result_shown"),
  resultQuality: resultQualitySchema,
  detectionCountBucket: detectionCountBucketSchema,
}).strict();

const productOpenedSchema = z.object({ action: z.literal("product_opened") }).strict();

const recommendationOpenedSchema = z.object({ action: z.literal("recommendation_opened") }).strict();

const scanRetriedSchema = z.object({ action: z.literal("scan_retried") }).strict();

const scanAbandonedSchema = z.object({
  action: z.literal("scan_abandoned"),
  abandonmentStage: z.enum(["camera", "preflight", "analysis", "result"]),
}).strict();

/**
 * Monetization-test funnel. These three events answer "how many people saw the
 * wall, how many started paying, how many ended up with access" and nothing
 * else. `grantSource` separates a fresh purchase from a restore so the two are
 * not counted as the same thing. Remove this block when the test ends.
 */
const paywallShownSchema = z.object({ action: z.literal("paywall_shown") }).strict();

const paywallCheckoutStartedSchema = z.object({ action: z.literal("paywall_checkout_started") }).strict();

const accessGrantedSchema = z.object({
  action: z.literal("access_granted"),
  grantSource: z.enum(["checkout", "restore"]),
}).strict();

/**
 * Browser-to-server product analytics contract. It is deliberately limited to
 * non-correlatable interaction classes and coarse result buckets. Do not add
 * IDs, timestamps, request metadata, product data, OCR, barcode data, image
 * properties, error strings, or free-form fields: stdout is a retained
 * external surface.
 */
export const resultMetricsSchema = z.discriminatedUnion("action", [
  scanStartedSchema,
  resultShownSchema,
  productOpenedSchema,
  recommendationOpenedSchema,
  scanRetriedSchema,
  scanAbandonedSchema,
  paywallShownSchema,
  paywallCheckoutStartedSchema,
  accessGrantedSchema,
]);

export type ResultMetrics = z.infer<typeof resultMetricsSchema>;

export const resultMetricsEnvelopeSchema = z.object({
  anonymousId: z.string().regex(/^[a-f0-9]{32}$/i).optional(),
  metric: resultMetricsSchema,
}).strict();

export type ResultMetricsEnvelope = z.infer<typeof resultMetricsEnvelopeSchema>;

/** This is intentionally the only payload written to stdout by this endpoint. */
export function logResultMetrics(metric: ResultMetrics, subjectHash?: string | null) {
  console.info(JSON.stringify({ event: "scan_result_metric", ...metric }));
  queueAnalyticsEvent({ eventName: "scan_result_metric", source: "browser", properties: metric, subjectHash });
}
