/**
 * Minimal, privacy-safe timing telemetry for the vision provider.
 *
 * Keep this payload deliberately narrow: never add request IDs, image sizes,
 * OCR text, product candidates, provider bodies, or credentials here. Railway
 * collects stdout, so every field must be safe to retain outside the request.
 */
export type VisionOperation = "preflight" | "analyze" | "nutrition_label";
export type VisionOutcome = "success" | "client_cancelled" | "bad_image" | "provider_timeout" | "provider_error" | "invalid_provider_response" | "not_configured" | "unexpected_error";

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
  operation: Extract<VisionOperation, "preflight" | "analyze">;
  model: string;
  durationMs: number;
  status: 200;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

export function logVisionTelemetry(metric: VisionTelemetry) {
  // JSON makes this easy to query in Railway logs without relying on text
  // parsing. `model` is configuration, not customer or product data.
  console.info(JSON.stringify({ event: "vision_request", ...metric }));
}

/** Provider-supplied counters only; callers gate this temporary event. */
export function logVisionUsageTelemetry(metric: VisionUsageTelemetry) {
  console.info(JSON.stringify({ event: "vision_usage", ...metric }));
}
