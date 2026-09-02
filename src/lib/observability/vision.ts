import { queueAnalyticsEvent } from "@/lib/analytics/events";

/**
 * Minimal, privacy-safe timing telemetry for the vision provider.
 *
 * Keep this payload deliberately narrow: never add request IDs, image sizes,
 * OCR text, product candidates, provider bodies, or credentials here. Railway
 * collects stdout, so every field must be safe to retain outside the request.
 */
export type VisionOperation = "preflight" | "analyze" | "nutrition_label";
export type VisionOutcome = "success" | "client_cancelled" | "bad_image" | "provider_timeout" | "provider_error" | "invalid_provider_response" | "rate_limiter_unavailable" | "gemini_minute_budget_exhausted" | "gemini_daily_budget_exhausted" | "not_configured" | "unexpected_error";

type VisionTelemetry = {
  operation: VisionOperation;
  model: string;
  // Time from route entry (request received, before body parsing/rate
  // limiting) to the moment this vision call started. A value that grows
  // during traffic bursts points at queueing/event-loop contention ahead of
  // the Gemini call, not at Gemini itself.
  queueMs: number;
  durationMs: number;
  timeoutMs: number;
  outcome: VisionOutcome;
  status: number;
  // Present only for analyze calls eligible for the speculative hedge (a
  // small expectedProductCount): "primary_won" when the first attempt
  // answered before the hedge fired or finished first anyway, "hedge_won"
  // when the duplicate parallel call came back first. Absent entirely when
  // the call was not eligible for a hedge.
  hedge?: "primary_won" | "hedge_won";
};

export type VisionUsageTelemetry = {
  operation: VisionOperation;
  model: string;
  durationMs: number;
  status: 200;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  pricingVersion?: string;
  estimatedCostUsd?: number;
};

export function logVisionTelemetry(metric: VisionTelemetry) {
  // JSON makes this easy to query in Railway logs without relying on text
  // parsing. `model` is configuration, not customer or product data.
  console.info(JSON.stringify({ event: "vision_request", ...metric }));
  queueAnalyticsEvent({ eventName: "vision_request", source: "server", properties: metric });
}

/** Provider-supplied counters only; callers gate this temporary event. */
export function logVisionUsageTelemetry(metric: VisionUsageTelemetry) {
  console.info(JSON.stringify({ event: "vision_usage", ...metric }));
  queueAnalyticsEvent({ eventName: "vision_usage", source: "server", properties: metric });
}

/**
 * TEMPORARY, deliberate exception to this file's own "never log product
 * candidates or OCR text" rule above — added 2026-09-01 to investigate a
 * real bug (Gemini returning a generic container description, e.g. "Glass
 * Bottled Drink", as `name` with no `brand`, which then passed the
 * eligibility filter). We need to actually read the `name` text on a sample
 * of these to tell "garbage generic guess" from "a real product Gemini just
 * didn't split into a separate brand field" before changing any filtering
 * logic — a decision from real examples, not a guess.
 *
 * Delete this function, its call site in gemini.ts, and the accumulated
 * `detection_unbranded_name` rows (analytics_events table) by ~2026-09-16
 * (15 days). Do not let this become a permanent logging path — the name
 * text is exactly what the rule above exists to keep out of retained logs.
 */
export function logUnbrandedDetectionNameForReview(input: { operation: "analyze"; name: string; confidence: number; hasSugarEstimate: boolean }) {
  console.info(JSON.stringify({ event: "detection_unbranded_name", ...input }));
  queueAnalyticsEvent({ eventName: "detection_unbranded_name", source: "server", properties: input });
}
