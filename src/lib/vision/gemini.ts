import { z } from "zod";
import { estimateGeminiCost } from "@/lib/analytics/gemini-cost";
import type { AnalyzeScanRequest, AnalyzeScanResponse, Detection, PreflightScanRequest, PreflightScanResponse } from "@/lib/contracts/scan";
import type { NormalizedBox, ScoreBand } from "@/lib/contracts/product";
import { isVisionUsageMetricsEnabled, type ServerEnv } from "@/lib/env";
import { logVisionTelemetry, logVisionUsageTelemetry, type VisionOperation, type VisionOutcome } from "@/lib/observability/vision";
import { acquireGeminiPermit, reserveGeminiRequest, type GeminiOperation } from "@/lib/observability/redis-guard";

// Multimodal detection on a full shelf can take longer than a text response.
// The scanner freezes the captured frame while waiting, so prefer a reliable
// result over cancelling a valid request at the former 12-second threshold.
// Trimmed from 30s to 25s (still well clear of that 12s regression) once the
// threshold benchmark showed typical latency around 2-3s.
const GEMINI_TIMEOUT_MS = 25_000;
// A preflight timeout on the live camera no longer ends the session outright:
// the client retries a bounded number of times with a "Reconnecting…" hint
// before falling back to the blocking prompt, so this can run tighter than
// it used to without turning a network blip into a forced Try again tap.
const GEMINI_PREFLIGHT_TIMEOUT_MS = 5_000;
// One bounded retry on a transient transport failure (timeout/5xx), never on
// a parsed-but-invalid or low-confidence response. Deliberately shorter than
// the first attempt so a repeat failure does not double the user's wait.
const GEMINI_ANALYZE_RETRY_TIMEOUT_MS = 8_000;
// Speculative hedge: on a shelf preflight already estimated as small
// (expectedProductCount below this), a slow analyze response is more likely
// a random per-request stall than a genuinely long generation, since output
// length scales with detected products. Fire one parallel duplicate call
// after GEMINI_HEDGE_DELAY_MS if the first attempt hasn't answered yet, and
// take whichever settles first. Skipped entirely for crowded shelves (or
// gallery uploads, which never populate expectedProductCount) where the
// slowness is structural and a duplicate call would only double token spend
// without shortening the wait.
const GEMINI_HEDGE_DELAY_MS = 7_000;
const GEMINI_HEDGE_MAX_EXPECTED_PRODUCTS = 10;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PREFLIGHT_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DETECTIONS = 20;

const geminiDetectionSchema = z.object({
  // Gemini object detection boxes use a 0..1000 coordinate system: [ymin, xmin, ymax, xmax].
  box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  brand: z.string().trim().max(120).nullable().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  packSize: z.string().trim().max(80).nullable().optional(),
  gtin: z.string().trim().max(32).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  estimatedSugarPer100g: z.number().min(0).max(200).nullable().optional(),
  estimateReason: z.string().trim().max(280).nullable().optional(),
});

const geminiResponseSchema = z.object({
  // Validate detections independently below. A single malformed item or an
  // over-complete shelf response must not discard every usable product.
  detections: z.array(z.unknown()),
});

const geminiPreflightResponseSchema = z.object({
  decision: z.enum(["candidate", "none", "uncertain"]),
  packagedProductCount: z.number().int().min(0).max(MAX_DETECTIONS),
  confidence: z.number().min(0).max(1),
  reasonCode: z.enum(["packaged_food_or_drink", "no_packaged_product", "person_or_document", "screen", "blur_or_distance"]),
});

export class VisionRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: "client_cancelled" | "bad_image" | "provider_timeout" | "provider_error" | "invalid_provider_response" | "rate_limiter_unavailable",
  ) {
    super(message);
    this.name = "VisionRequestError";
  }
}

type AttemptAbort = {
  signal: AbortSignal;
  reason: () => "client_cancelled" | "provider_timeout" | null;
  dispose: () => void;
};

/**
 * Each Gemini attempt has its own bounded timeout, while the incoming Route
 * Handler request can stop every attempt (including a pending retry) as soon
 * as the browser closes or retries the scanner.
 */
function createAttemptAbort(requestSignal: AbortSignal | undefined, timeoutMs: number): AttemptAbort {
  const controller = new AbortController();
  let abortReason: "client_cancelled" | "provider_timeout" | null = null;
  const abortForClient = () => {
    if (controller.signal.aborted) return;
    abortReason = "client_cancelled";
    controller.abort(requestSignal?.reason);
  };
  if (requestSignal?.aborted) abortForClient();
  else requestSignal?.addEventListener("abort", abortForClient, { once: true });
  const timeout = setTimeout(() => {
    if (controller.signal.aborted) return;
    abortReason = "provider_timeout";
    controller.abort(new DOMException("Gemini request timed out.", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    reason: () => abortReason,
    dispose: () => {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", abortForClient);
    },
  };
}

function abortVisionError(reason: "client_cancelled" | "provider_timeout" | null): VisionRequestError {
  return reason === "client_cancelled"
    ? new VisionRequestError("Scan request was cancelled by the client.", 499, "client_cancelled")
    : new VisionRequestError("Vision provider took too long to respond. Try again.", 504, "provider_timeout");
}

async function throwGeminiProviderError(response: Response, action: "analyze" | "preflight"): Promise<never> {
  const payload = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
  const providerMessage = typeof payload?.error?.message === "string"
    ? payload.error.message.replace(/\s+/g, " ").slice(0, 240)
    : "No diagnostic message was returned.";
  throw new VisionRequestError(
    `Vision provider could not ${action} this frame: ${providerMessage}`,
    response.status >= 400 && response.status < 500 ? 422 : 502,
    "provider_error",
  );
}

function telemetryOutcome(error: unknown): VisionOutcome {
  if (error instanceof VisionRequestError) return error.code;
  return "unexpected_error";
}

function telemetryStatus(error: unknown): number {
  if (error instanceof VisionRequestError) return error.status;
  return 500;
}

function logAttempt(
  operation: VisionOperation,
  model: string,
  receivedAt: number,
  startedAt: number,
  timeoutMs: number,
  error?: unknown,
  hedge?: "primary_won" | "hedge_won",
) {
  logVisionTelemetry({
    operation,
    model,
    queueMs: Math.round(startedAt - receivedAt),
    durationMs: Math.round(performance.now() - startedAt),
    timeoutMs,
    outcome: error ? telemetryOutcome(error) : "success",
    status: error ? telemetryStatus(error) : 200,
    ...(hedge ? { hedge } : {}),
  });
}

const geminiUsageMetadataSchema = z.object({
  promptTokenCount: z.number().finite().int().min(0).optional(),
  candidatesTokenCount: z.number().finite().int().min(0).optional(),
  thoughtsTokenCount: z.number().finite().int().min(0).optional(),
  totalTokenCount: z.number().finite().int().min(0).optional(),
});

/** Extract only provider-issued aggregate counters; malformed fields are ignored. */
export function extractGeminiUsageMetadata(payload: unknown) {
  const root = z.object({ usageMetadata: geminiUsageMetadataSchema.optional() }).passthrough().safeParse(payload);
  return root.success ? root.data.usageMetadata : undefined;
}

function logGeminiUsage(
  operation: Extract<VisionOperation, "preflight" | "analyze">,
  model: string,
  startedAt: number,
  payload: unknown,
) {
  if (!isVisionUsageMetricsEnabled()) return;
  const usage = extractGeminiUsageMetadata(payload);
  const estimate = usage ? estimateGeminiCost(model, usage) : null;
  logVisionUsageTelemetry({
    operation,
    model,
    durationMs: Math.round(performance.now() - startedAt),
    status: 200,
    ...(usage ?? {}),
    ...(estimate ? { pricingVersion: estimate.pricingVersion, estimatedCostUsd: estimate.estimatedCostUsd } : {}),
  });
}

function imageByteLength(base64: string) {
  const encoded = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return -1;
  return Math.floor((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
}

function bandForSugar(sugarPer100g: number | null): ScoreBand {
  if (sugarPer100g === null) return "unknown";
  if (sugarPer100g <= 5) return "green";
  if (sugarPer100g <= 12) return "yellow";
  if (sugarPer100g <= 22.5) return "orange";
  return "red";
}

function normalizeBox([yMin, xMin, yMax, xMax]: [number, number, number, number]): NormalizedBox | null {
  const left = Math.max(0, Math.min(1000, xMin));
  const top = Math.max(0, Math.min(1000, yMin));
  const right = Math.max(0, Math.min(1000, xMax));
  const bottom = Math.max(0, Math.min(1000, yMax));
  if (right <= left || bottom <= top) return null;

  return {
    x: left / 1000,
    y: top / 1000,
    width: (right - left) / 1000,
    height: (bottom - top) / 1000,
  };
}

function promptFor(context: AnalyzeScanRequest["context"]) {
  const contextInstruction = context === "shelf"
    ? "Find every distinct packaged food or drink product that is sufficiently visible. Do not return shelf labels, prices, or duplicate facings of the same product."
    : context === "barcode"
      ? "Find the single packaged product associated with the visible barcode."
      : "Find the single packaged product whose nutrition label is visible.";

  return `You analyze packaged grocery products for a sugar-awareness app. ${contextInstruction}

Return JSON only, matching the supplied schema. Each box_2d is [ymin, xmin, ymax, xmax] normalized to integers or decimals in 0..1000 relative to the entire image. Use only a box for a visible product package. Identify brand, product name, and pack size when legible. When a UPC/EAN/GTIN barcode number is clearly readable, return its digits in gtin; otherwise omit gtin. estimatedSugarPer100g is a visual estimate only; omit it when it cannot be responsibly inferred. confidence reflects visual identification certainty, not nutrition certainty. Return an empty detections array when no qualifying packaged product is visible.`;
}

function preflightPrompt() {
  return `You are the preflight gate for a grocery shelf scanner. Decide whether this camera preview contains at least one real, visible packaged FOOD or DRINK product that is suitable for a high-resolution scan.

Return candidate ONLY when at least one physical, packaged grocery food or beverage is visible and its packaging is sufficiently clear to attempt reading its brand or product name. Count distinct visible product packages or distinct SKUs; do not count duplicate facings separately.

Return none for people, faces, hands, documents, books, receipts, nutrition labels alone, computer/phone screens, empty rooms, furniture, loose food, cookware, or non-food packages. A screen showing a product is still screen, not candidate. Return uncertain only when a possible packaged food/drink is present but is too blurred, too small, too occluded, or too far away.

Set reasonCode exactly to: packaged_food_or_drink for candidate; person_or_document for people/documents/labels; screen for screens; blur_or_distance for uncertain; or no_packaged_product for every other negative scene. Set packagedProductCount to 0 unless decision is candidate. This step must not identify products, estimate nutrition, return boxes, or infer facts. Return JSON only matching the supplied schema.`;
}

// Gemini 3's four-tier scale (minimal/low/medium/high) has no literal "off"
// the way 2.5's thinkingBudget:0 did; "minimal" is the closest analog and is
// what the docs recommend for classification-shaped calls. Preflight is pure
// classification (candidate/none/uncertain + a count) with no need to reason
// about brand, text, or nutrition, so it gets that floor; analyze still
// benefits from some reasoning over what it's actually detecting, so it
// stays at "low" rather than dropping further without its own evaluation.
function thinkingConfigFor(model: string, gemini3Level: "minimal" | "low" = "low") {
  // Gemini 3 uses thinkingLevel while Gemini 2.5 uses thinkingBudget. Keeping
  // this branch server-side makes a Railway model change safe.
  return model.startsWith("gemini-2.5-")
    ? { thinkingBudget: 0 }
    : { thinkingLevel: gemini3Level };
}

function parseGeminiText<T>(payload: unknown, schema: z.ZodType<T>) {
  const text = z
    .object({
      candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1),
    })
    .safeParse(payload);
  const value = text.success ? text.data.candidates[0]?.content.parts.map((part) => part.text ?? "").join("") : "";
  if (!value) throw new VisionRequestError("Vision provider returned no usable content.", 502, "invalid_provider_response");

  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new VisionRequestError("Vision provider returned an invalid structured response.", 502, "invalid_provider_response");
  }
}

function toDetection(item: z.infer<typeof geminiDetectionSchema>, index: number): Detection | null {
  const box = normalizeBox(item.box_2d);
  if (!box) return null;
  const name = item.name?.trim() || null;
  const brand = item.brand?.trim() || null;
  const sugar = item.estimatedSugarPer100g ?? null;
  const confidence = item.confidence ?? (name || brand ? 0.55 : 0.35);
  const canEstimate = sugar !== null;

  return {
    id: `vision-${index + 1}`,
    box,
    confidence,
    status: canEstimate ? "estimate" : "unknown",
    visualCandidate: { brand, name, packSize: item.packSize?.trim() || null, gtin: item.gtin?.replace(/\D/g, "") || null },
    score: { band: bandForSugar(sugar), sugarPer100g: sugar, source: canEstimate ? "vision_estimate" : "unavailable" },
    product: null,
    estimateReason: canEstimate
      ? item.estimateReason?.trim() || "Estimated from visible packaging; confirm with a barcode or nutrition label."
      : item.estimateReason?.trim() || "Take a closer photo, barcode, or nutrition label to confirm this product.",
  };
}

export function normalizeGeminiDetections(items: unknown[]): Detection[] {
  const detections: Detection[] = [];
  // Gemini is also instructed with maxItems, but keep a defensive input cap in
  // case a provider version ignores the response schema.
  for (const [index, item] of items.slice(0, MAX_DETECTIONS * 4).entries()) {
    const parsed = geminiDetectionSchema.safeParse(item);
    if (!parsed.success) continue;
    const detection = toDetection(parsed.data, index);
    if (detection) detections.push(detection);
    if (detections.length === MAX_DETECTIONS) break;
  }
  return detections;
}

/** Every actual provider call, including a hedge or retry, holds a shared lease. */
async function guardedGeminiFetch(operation: GeminiOperation, input: RequestInfo | URL, init: RequestInit) {
  // Preserve synchronous dispatch in local/test mode: cancellation tests and
  // the camera lifecycle rely on fetch observing the already-wired signal.
  if (!process.env.REDIS_URL && process.env.NODE_ENV !== "production") return fetch(input, init);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireGeminiPermit(operation);
    await reserveGeminiRequest();
  } catch {
    if (release) await release();
    throw new VisionRequestError("Scan protection is temporarily unavailable.", 503, "rate_limiter_unavailable");
  }
  try {
    return await fetch(input, init);
  } finally {
    await release();
  }
}

async function attemptAnalyze(input: AnalyzeScanRequest, env: ServerEnv, timeoutMs: number, requestSignal?: AbortSignal): Promise<AnalyzeScanResponse> {
  const attemptStartedAt = performance.now();
  const abort = createAttemptAbort(requestSignal, timeoutMs);
  try {
    // analyzeWithGemini already rejected a missing key before ever calling
    // this helper (including on a retry, since the key does not change
    // between attempts) — the assertion just satisfies a type that cannot
    // narrow across the function boundary.
    if (abort.signal.aborted) throw abortVisionError(abort.reason());
    const response = await guardedGeminiFetch("analyze", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_VISION_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY!)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptFor(input.context) }, { inline_data: { mime_type: input.mimeType, data: input.imageBase64.replace(/^data:[^;]+;base64,/, "") } }] }],
        generationConfig: {
          // Shelf recognition is latency-sensitive. Configure the supported
          // low-latency thinking mode for the model selected in Railway.
          thinkingConfig: thinkingConfigFor(env.GEMINI_VISION_MODEL),
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              detections: {
                type: "ARRAY",
                maxItems: MAX_DETECTIONS,
                items: {
                  type: "OBJECT",
                  properties: {
                    box_2d: { type: "ARRAY", items: { type: "NUMBER" }, minItems: 4, maxItems: 4 },
                    brand: { type: "STRING", nullable: true }, name: { type: "STRING", nullable: true }, packSize: { type: "STRING", nullable: true }, gtin: { type: "STRING", nullable: true },
                    confidence: { type: "NUMBER" }, estimatedSugarPer100g: { type: "NUMBER", nullable: true }, estimateReason: { type: "STRING", nullable: true },
                  },
                  required: ["box_2d"],
                },
              },
            },
            required: ["detections"],
          },
        },
      }),
    });

    if (!response.ok) {
      await throwGeminiProviderError(response, "analyze");
    }
    const payload = await response.json();
    logGeminiUsage("analyze", env.GEMINI_VISION_MODEL, attemptStartedAt, payload);
    const parsed = parseGeminiText(payload, geminiResponseSchema);
    const detections = normalizeGeminiDetections(parsed.detections);
    return {
      scanId: `gemini-${crypto.randomUUID()}`,
      clientFrameId: input.clientFrameId,
      provider: "gemini",
      detections,
      analyzedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof VisionRequestError) throw error;
    if (abort.reason() || (error instanceof Error && error.name === "AbortError")) {
      throw abortVisionError(abort.reason());
    }
    throw new VisionRequestError("Unable to reach the vision provider.", 502, "provider_error");
  } finally {
    abort.dispose();
  }
}

/**
 * Races the primary attempt against one duplicate call fired after
 * GEMINI_HEDGE_DELAY_MS if the primary is still pending at that point.
 * Whichever settles successfully first wins; the loser's eventual result is
 * discarded (its own AttemptAbort still tears down independently once its
 * own timeout elapses). Only a genuine failure of *both* attempts rejects,
 * and it reports the primary's error since that is the one the existing
 * sequential-retry logic in analyzeWithGemini already knows how to classify.
 */
function attemptAnalyzeWithHedge(
  input: AnalyzeScanRequest,
  env: ServerEnv,
  timeoutMs: number,
  requestSignal: AbortSignal | undefined,
): Promise<{ result: AnalyzeScanResponse; hedge: "primary_won" | "hedge_won" }> {
  return new Promise((resolve, reject) => {
    let primarySettled = false;
    let outcomeSent = false;
    let pending = 1;
    let firstError: unknown;

    const fail = (error: unknown) => {
      if (outcomeSent) return;
      firstError ??= error;
      pending -= 1;
      if (pending === 0) { outcomeSent = true; reject(firstError); }
    };
    const succeed = (result: AnalyzeScanResponse, hedge: "primary_won" | "hedge_won") => {
      if (outcomeSent) return;
      outcomeSent = true;
      clearTimeout(hedgeTimer);
      resolve({ result, hedge });
    };

    const hedgeTimer = setTimeout(() => {
      if (primarySettled || outcomeSent) return;
      pending += 1;
      // Give the hedge the remaining budget, not a fresh full window — it
      // must not outlive the primary's own deadline.
      const hedgeTimeoutMs = Math.max(3_000, timeoutMs - GEMINI_HEDGE_DELAY_MS);
      attemptAnalyze(input, env, hedgeTimeoutMs, requestSignal).then(
        (result) => succeed(result, "hedge_won"),
        (error: unknown) => fail(error),
      );
    }, GEMINI_HEDGE_DELAY_MS);

    attemptAnalyze(input, env, timeoutMs, requestSignal).then(
      (result) => { primarySettled = true; succeed(result, "primary_won"); },
      (error: unknown) => { primarySettled = true; fail(error); },
    );
  });
}

/** Only a transient transport failure is worth one quick retry; a parsed
 *  response (even a bad one) or a client-side config problem will not
 *  change on a second attempt. */
function isRetryableAnalyzeFailure(error: unknown): boolean {
  return error instanceof VisionRequestError
    && (error.code === "provider_timeout" || (error.code === "provider_error" && error.status >= 500));
}

export async function analyzeWithGemini(input: AnalyzeScanRequest, env: ServerEnv, receivedAt: number, requestSignal?: AbortSignal): Promise<AnalyzeScanResponse> {
  const startedAt = performance.now();
  try {
    if (!env.GEMINI_API_KEY) throw new VisionRequestError("Gemini is not configured.", 503, "provider_error");
    const bytes = imageByteLength(input.imageBase64);
    if (bytes <= 0 || bytes > MAX_IMAGE_BYTES) {
      throw new VisionRequestError("Image must be a valid base64 image smaller than 6 MB.", 413, "bad_image");
    }

    const eligibleForHedge = input.expectedProductCount !== undefined && input.expectedProductCount < GEMINI_HEDGE_MAX_EXPECTED_PRODUCTS;
    try {
      if (eligibleForHedge) {
        const { result, hedge } = await attemptAnalyzeWithHedge(input, env, GEMINI_TIMEOUT_MS, requestSignal);
        logAttempt("analyze", env.GEMINI_VISION_MODEL, receivedAt, startedAt, GEMINI_TIMEOUT_MS, undefined, hedge);
        return result;
      }
      const result = await attemptAnalyze(input, env, GEMINI_TIMEOUT_MS, requestSignal);
      logAttempt("analyze", env.GEMINI_VISION_MODEL, receivedAt, startedAt, GEMINI_TIMEOUT_MS);
      return result;
    } catch (firstError) {
      if (!isRetryableAnalyzeFailure(firstError)) throw firstError;
      const result = await attemptAnalyze(input, env, GEMINI_ANALYZE_RETRY_TIMEOUT_MS, requestSignal);
      logAttempt("analyze", env.GEMINI_VISION_MODEL, receivedAt, startedAt, GEMINI_TIMEOUT_MS + GEMINI_ANALYZE_RETRY_TIMEOUT_MS);
      return result;
    }
  } catch (error) {
    logAttempt("analyze", env.GEMINI_VISION_MODEL, receivedAt, startedAt, GEMINI_TIMEOUT_MS, error);
    throw error;
  }
}

/**
 * Cheap semantic gate for live camera previews. The browser stays live while
 * this runs; a caller must only freeze and invoke full analysis after a
 * `candidate` result. No image is persisted here.
 */
export async function preflightWithGemini(input: PreflightScanRequest, env: ServerEnv, receivedAt: number, requestSignal?: AbortSignal): Promise<PreflightScanResponse> {
  const startedAt = performance.now();
  // A/B split: only branches away from the configured model when a variant
  // is actually set, so this is a no-op everywhere the env var is absent.
  // Chosen once and reused for the fetch URL and every log line below, so a
  // single request's telemetry never mixes two model names.
  const model = env.GEMINI_PREFLIGHT_MODEL_VARIANT_B && Math.random() < 0.5
    ? env.GEMINI_PREFLIGHT_MODEL_VARIANT_B
    : env.GEMINI_PREFLIGHT_MODEL;
  let abort: AttemptAbort | undefined;
  try {
    if (!env.GEMINI_API_KEY) throw new VisionRequestError("Gemini is not configured.", 503, "provider_error");
    const bytes = imageByteLength(input.imageBase64);
    if (bytes <= 0 || bytes > MAX_PREFLIGHT_IMAGE_BYTES) {
      throw new VisionRequestError("Preflight image must be a valid base64 image smaller than 2 MB.", 413, "bad_image");
    }

    abort = createAttemptAbort(requestSignal, GEMINI_PREFLIGHT_TIMEOUT_MS);
    try {
    if (abort.signal.aborted) throw abortVisionError(abort.reason());
    const response = await guardedGeminiFetch("preflight", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: preflightPrompt() }, { inline_data: { mime_type: input.mimeType, data: input.imageBase64.replace(/^data:[^;]+;base64,/, "") } }] }],
        generationConfig: {
          // A full low-resolution preflight tier was tried once and rolled
          // back — it regressed recognition of small packaged products.
          // MEDIUM is a documented middle ground (560 image tokens vs the
          // unspecified default) rather than that same low tier, worth its
          // own before/after read rather than assumed equivalent.
          mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
          thinkingConfig: thinkingConfigFor(model, "minimal"),
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              decision: { type: "STRING", enum: ["candidate", "none", "uncertain"] },
              packagedProductCount: { type: "INTEGER" },
              confidence: { type: "NUMBER" },
              reasonCode: { type: "STRING", enum: ["packaged_food_or_drink", "no_packaged_product", "person_or_document", "screen", "blur_or_distance"] },
            },
            required: ["decision", "packagedProductCount", "confidence", "reasonCode"],
          },
        },
      }),
    });

    if (!response.ok) {
      await throwGeminiProviderError(response, "preflight");
    }
    const payload = await response.json();
    logGeminiUsage("preflight", model, startedAt, payload);
    const parsed = parseGeminiText(payload, geminiPreflightResponseSchema);
    // Keep the invariant meaningful even if a model returns internally
    // inconsistent fields despite the schema instructions.
    const isCandidate = parsed.decision === "candidate" && parsed.packagedProductCount > 0;
    logAttempt("preflight", model, receivedAt, startedAt, GEMINI_PREFLIGHT_TIMEOUT_MS);
    return {
      clientFrameId: input.clientFrameId,
      provider: "gemini",
      decision: isCandidate ? "candidate" : parsed.decision === "candidate" ? "uncertain" : parsed.decision,
      packagedProductCount: isCandidate ? parsed.packagedProductCount : 0,
      confidence: parsed.confidence,
      reasonCode: isCandidate ? "packaged_food_or_drink" : parsed.decision === "candidate" ? "blur_or_distance" : parsed.reasonCode,
      analyzedAt: new Date().toISOString(),
    };
    } finally {
      abort.dispose();
    }
  } catch (error) {
    if (error instanceof VisionRequestError) {
      logAttempt("preflight", model, receivedAt, startedAt, GEMINI_PREFLIGHT_TIMEOUT_MS, error);
      throw error;
    }
    if (abort?.reason() || (error instanceof Error && error.name === "AbortError")) {
      const timeoutError = abortVisionError(abort?.reason() ?? null);
      logAttempt("preflight", model, receivedAt, startedAt, GEMINI_PREFLIGHT_TIMEOUT_MS, timeoutError);
      throw timeoutError;
    }
    const providerError = new VisionRequestError("Unable to reach the vision provider.", 502, "provider_error");
    logAttempt("preflight", model, receivedAt, startedAt, GEMINI_PREFLIGHT_TIMEOUT_MS, providerError);
    throw providerError;
  }
}
