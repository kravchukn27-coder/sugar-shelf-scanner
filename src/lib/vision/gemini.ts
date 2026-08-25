import { z } from "zod";
import type { AnalyzeScanRequest, AnalyzeScanResponse, Detection } from "@/lib/contracts/scan";
import type { NormalizedBox, ScoreBand } from "@/lib/contracts/product";
import type { ServerEnv } from "@/lib/env";

// Multimodal detection on a full shelf can take longer than a text response.
// The scanner freezes the captured frame while waiting, so prefer a reliable
// result over cancelling a valid request at the former 12-second threshold.
const GEMINI_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_DETECTIONS = 12;

const geminiDetectionSchema = z.object({
  // Gemini object detection boxes use a 0..1000 coordinate system: [ymin, xmin, ymax, xmax].
  box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  brand: z.string().trim().max(120).nullable().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  packSize: z.string().trim().max(80).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  estimatedSugarPer100g: z.number().min(0).max(200).nullable().optional(),
  estimateReason: z.string().trim().max(280).nullable().optional(),
});

const geminiResponseSchema = z.object({
  detections: z.array(geminiDetectionSchema).max(MAX_DETECTIONS),
});

export class VisionRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: "bad_image" | "provider_timeout" | "provider_error" | "invalid_provider_response",
  ) {
    super(message);
    this.name = "VisionRequestError";
  }
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

Return JSON only, matching the supplied schema. Each box_2d is [ymin, xmin, ymax, xmax] normalized to integers or decimals in 0..1000 relative to the entire image. Use only a box for a visible product package. Identify brand, product name, and pack size when legible. estimatedSugarPer100g is a visual estimate only; omit it when it cannot be responsibly inferred. confidence reflects visual identification certainty, not nutrition certainty. Return an empty detections array when no qualifying packaged product is visible.`;
}

function thinkingConfigFor(model: string) {
  // Gemini 3 uses thinkingLevel while Gemini 2.5 uses thinkingBudget. Keeping
  // this branch server-side makes a Railway model change safe.
  return model.startsWith("gemini-2.5-")
    ? { thinkingBudget: 0 }
    : { thinkingLevel: "low" };
}

function parseGeminiText(payload: unknown) {
  const text = z
    .object({
      candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1),
    })
    .safeParse(payload);
  const value = text.success ? text.data.candidates[0]?.content.parts.map((part) => part.text ?? "").join("") : "";
  if (!value) throw new VisionRequestError("Vision provider returned no usable content.", 502, "invalid_provider_response");

  try {
    return geminiResponseSchema.parse(JSON.parse(value));
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
    visualCandidate: { brand, name, packSize: item.packSize?.trim() || null },
    score: { band: bandForSugar(sugar), sugarPer100g: sugar, source: canEstimate ? "vision_estimate" : "unavailable" },
    product: null,
    estimateReason: canEstimate
      ? item.estimateReason?.trim() || "Estimated from visible packaging; confirm with a barcode or nutrition label."
      : item.estimateReason?.trim() || "Take a closer photo, barcode, or nutrition label to confirm this product.",
  };
}

export async function analyzeWithGemini(input: AnalyzeScanRequest, env: ServerEnv): Promise<AnalyzeScanResponse> {
  if (!env.GEMINI_API_KEY) throw new VisionRequestError("Gemini is not configured.", 503, "provider_error");
  const bytes = imageByteLength(input.imageBase64);
  if (bytes <= 0 || bytes > MAX_IMAGE_BYTES) {
    throw new VisionRequestError("Image must be a valid base64 image smaller than 6 MB.", 413, "bad_image");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_VISION_MODEL)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
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
                items: {
                  type: "OBJECT",
                  properties: {
                    box_2d: { type: "ARRAY", items: { type: "NUMBER" }, minItems: 4, maxItems: 4 },
                    brand: { type: "STRING", nullable: true }, name: { type: "STRING", nullable: true }, packSize: { type: "STRING", nullable: true },
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
      throw new VisionRequestError("Vision provider could not analyze this frame.", response.status >= 400 && response.status < 500 ? 422 : 502, "provider_error");
    }
    const parsed = parseGeminiText(await response.json());
    const detections = parsed.detections.map(toDetection).filter((item): item is Detection => item !== null);
    return {
      scanId: `gemini-${crypto.randomUUID()}`,
      clientFrameId: input.clientFrameId,
      provider: "gemini",
      detections,
      analyzedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof VisionRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new VisionRequestError("Vision provider took too long to respond. Try again.", 504, "provider_timeout");
    }
    throw new VisionRequestError("Unable to reach the vision provider.", 502, "provider_error");
  } finally {
    clearTimeout(timeout);
  }
}
