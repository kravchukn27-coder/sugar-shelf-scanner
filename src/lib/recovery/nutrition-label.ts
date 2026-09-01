import { z } from "zod";
import {
  nutritionLabelDraftSchema,
  nutritionLabelRecoveryResponseSchema,
  type NutritionLabelRecoveryRequest,
  type NutritionLabelRecoveryResponse,
} from "@/lib/contracts/scan";
import type { ServerEnv } from "@/lib/env";
import { estimateGeminiCost } from "@/lib/analytics/gemini-cost";
import { logVisionTelemetry, logVisionUsageTelemetry, type VisionOutcome } from "@/lib/observability/vision";
import { acquireGeminiPermit, reserveGeminiRequest } from "@/lib/observability/redis-guard";

const LABEL_TIMEOUT_MS = 30_000;
const MAX_LABEL_IMAGE_BYTES = 6 * 1024 * 1024;

/**
 * This error intentionally contains no provider diagnostic. Provider bodies
 * can contain an OCR fragment or product identity and must never reach logs.
 */
export class NutritionLabelRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: "bad_image" | "provider_timeout" | "provider_error" | "invalid_provider_response" | "rate_limiter_unavailable",
  ) {
    super(message);
    this.name = "NutritionLabelRequestError";
  }
}

const providerDraftSchema = nutritionLabelDraftSchema;
const providerResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("nutrition_label"), draft: providerDraftSchema }).strict(),
  z.object({ outcome: z.literal("unreadable") }).strict(),
]);

const usageSchema = z.object({
  promptTokenCount: z.number().finite().int().min(0).optional(),
  candidatesTokenCount: z.number().finite().int().min(0).optional(),
  thoughtsTokenCount: z.number().finite().int().min(0).optional(),
  totalTokenCount: z.number().finite().int().min(0).optional(),
});

function imageByteLength(base64: string) {
  const encoded = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return -1;
  return Math.floor((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
}

function labelPrompt() {
  return `Read one photographed Nutrition Facts / nutrition declaration for a packaged food or drink.

Return JSON only matching the supplied schema. Set outcome to "nutrition_label" only when a nutrition label is readable enough to extract at least one per-100g nutrition value. Otherwise set outcome to "unreadable" with no draft.

For nutrition_label, extract product identity (brand and name when visible), pack size, and energy kcal, protein, fat, carbohydrates, and sugars per 100 g. Use null when a field is absent, not legible, or only stated for a serving with no reliable conversion. Never invent, estimate, convert, or infer a value. fieldConfidence must contain a 0..1 confidence or null for every field. Do not transcribe the label or return any fields outside the schema.`;
}

function responseSchema() {
  return {
    type: "OBJECT",
    properties: {
      outcome: { type: "STRING", enum: ["nutrition_label", "unreadable"] },
      draft: {
        type: "OBJECT",
        nullable: true,
        properties: {
          brand: { type: "STRING", nullable: true },
          name: { type: "STRING", nullable: true },
          packSize: { type: "STRING", nullable: true },
          energyKcal: { type: "NUMBER", nullable: true },
          proteinPer100g: { type: "NUMBER", nullable: true },
          fatPer100g: { type: "NUMBER", nullable: true },
          carbohydratesPer100g: { type: "NUMBER", nullable: true },
          sugarPer100g: { type: "NUMBER", nullable: true },
          fieldConfidence: {
            type: "OBJECT",
            properties: {
              brand: { type: "NUMBER", nullable: true }, name: { type: "NUMBER", nullable: true }, packSize: { type: "NUMBER", nullable: true },
              energyKcal: { type: "NUMBER", nullable: true }, proteinPer100g: { type: "NUMBER", nullable: true }, fatPer100g: { type: "NUMBER", nullable: true },
              carbohydratesPer100g: { type: "NUMBER", nullable: true }, sugarPer100g: { type: "NUMBER", nullable: true },
            },
            required: ["brand", "name", "packSize", "energyKcal", "proteinPer100g", "fatPer100g", "carbohydratesPer100g", "sugarPer100g"],
          },
        },
        required: ["brand", "name", "packSize", "energyKcal", "proteinPer100g", "fatPer100g", "carbohydratesPer100g", "sugarPer100g", "fieldConfidence"],
      },
    },
    required: ["outcome"],
  };
}

function parseProviderResponse(payload: unknown): NutritionLabelRecoveryResponse {
  const candidate = z.object({
    candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1),
  }).safeParse(payload);
  const text = candidate.success ? candidate.data.candidates[0]?.content.parts.map((part) => part.text ?? "").join("") : "";
  if (!text) throw new NutritionLabelRequestError("The nutrition label could not be read. Take another photo.", 502, "invalid_provider_response");
  try {
    return nutritionLabelRecoveryResponseSchema.parse(providerResponseSchema.parse(JSON.parse(text)));
  } catch {
    throw new NutritionLabelRequestError("The nutrition label could not be read. Take another photo.", 502, "invalid_provider_response");
  }
}

function outcomeFor(error: unknown): VisionOutcome {
  return error instanceof NutritionLabelRequestError ? error.code : "unexpected_error";
}

function logAttempt(env: ServerEnv, receivedAt: number, startedAt: number, error?: unknown) {
  logVisionTelemetry({
    operation: "nutrition_label",
    model: env.GEMINI_VISION_MODEL,
    queueMs: Math.round(startedAt - receivedAt),
    durationMs: Math.round(performance.now() - startedAt),
    timeoutMs: LABEL_TIMEOUT_MS,
    outcome: error ? outcomeFor(error) : "success",
    status: error instanceof NutritionLabelRequestError ? error.status : error ? 500 : 200,
  });
}

/** Exactly one provider call for one explicitly consented still image. */
export async function extractNutritionLabelWithGemini(input: NutritionLabelRecoveryRequest, env: ServerEnv, receivedAt: number): Promise<NutritionLabelRecoveryResponse> {
  const startedAt = performance.now();
  try {
    if (!env.GEMINI_API_KEY) throw new NutritionLabelRequestError("Nutrition label reading is not configured.", 503, "provider_error");
    const bytes = imageByteLength(input.imageBase64);
    if (bytes <= 0 || bytes > MAX_LABEL_IMAGE_BYTES) {
      throw new NutritionLabelRequestError("Use a valid nutrition-label image smaller than 6 MB.", 413, "bad_image");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LABEL_TIMEOUT_MS);
    try {
      let release: (() => Promise<void>) | undefined;
      try {
        release = await acquireGeminiPermit("nutrition_label");
        await reserveGeminiRequest("nutrition_label");
      } catch {
        if (release) await release();
        throw new NutritionLabelRequestError("Scan protection is temporarily unavailable.", 503, "rate_limiter_unavailable");
      }
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_VISION_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: labelPrompt() }, { inline_data: { mime_type: input.mimeType, data: input.imageBase64.replace(/^data:[^;]+;base64,/, "") } }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema() },
        }),
      });
      try {
        if (!response.ok) throw new NutritionLabelRequestError("Nutrition label reading is temporarily unavailable. Take another photo and try again.", response.status >= 400 && response.status < 500 ? 422 : 502, "provider_error");
        const payload = await response.json();
        const usage = z.object({ usageMetadata: usageSchema.optional() }).passthrough().safeParse(payload).data?.usageMetadata;
        if (usage && process.env.VISION_USAGE_METRICS_ENABLED === "true") {
          const estimate = estimateGeminiCost(env.GEMINI_VISION_MODEL, usage);
          logVisionUsageTelemetry({
            operation: "nutrition_label",
            model: env.GEMINI_VISION_MODEL,
            durationMs: Math.round(performance.now() - startedAt),
            status: 200,
            ...usage,
            ...(estimate ? { pricingVersion: estimate.pricingVersion, estimatedCostUsd: estimate.estimatedCostUsd } : {}),
          });
        }
        const parsed = parseProviderResponse(payload);
        logAttempt(env, receivedAt, startedAt);
        return parsed;
      } finally {
        await release();
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof NutritionLabelRequestError) {
      logAttempt(env, receivedAt, startedAt, error);
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new NutritionLabelRequestError("Nutrition label reading took too long. Take another photo and try again.", 504, "provider_timeout");
      logAttempt(env, receivedAt, startedAt, timeoutError);
      throw timeoutError;
    }
    const providerError = new NutritionLabelRequestError("Nutrition label reading is temporarily unavailable. Take another photo and try again.", 502, "provider_error");
    logAttempt(env, receivedAt, startedAt, providerError);
    throw providerError;
  }
}
