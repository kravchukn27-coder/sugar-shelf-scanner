import assert from "node:assert/strict";
import test from "node:test";
import { nutritionLabelRecoveryRequestSchema } from "@/lib/contracts/scan";
import type { ServerEnv } from "@/lib/env";
import { extractNutritionLabelWithGemini, NutritionLabelRequestError } from "./nutrition-label";

const env: ServerEnv = {
  VISION_PROVIDER: "gemini",
  GEMINI_API_KEY: "test-key",
  GEMINI_VISION_MODEL: "gemini-test",
  GEMINI_PREFLIGHT_MODEL: "gemini-test",
};
const request = { imageBase64: "AQID", mimeType: "image/jpeg" as const, labelCaptureConsented: true as const };
const confidence = { brand: 0.9, name: 0.8, packSize: null, energyKcal: 0.95, proteinPer100g: 0.95, fatPer100g: 0.95, carbohydratesPer100g: 0.95, sugarPer100g: 0.95 };

function providerJson(value: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 });
}

test("nutrition-label recovery requires explicit consent and rejects raw OCR fields", () => {
  assert.equal(nutritionLabelRecoveryRequestSchema.safeParse({ ...request, labelCaptureConsented: false }).success, false);
  assert.equal(nutritionLabelRecoveryRequestSchema.safeParse({ ...request, rawOcr: "not allowed" }).success, false);
});

test("nutrition-label recovery makes one provider request and returns only the draft", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.contents[0].parts[1].inline_data.data, "AQID");
    assert.match(body.contents[0].parts[0].text, /Do not transcribe the label/);
    return providerJson({
      outcome: "nutrition_label",
      draft: { brand: "Example", name: "Drink", packSize: "330 ml", energyKcal: 40, proteinPer100g: 0, fatPer100g: 0, carbohydratesPer100g: 9, sugarPer100g: 8.5, fieldConfidence: confidence },
    });
  };
  try {
    const result = await extractNutritionLabelWithGemini(request, env, performance.now());
    assert.equal(calls, 1);
    assert.deepEqual(result, {
      outcome: "nutrition_label",
      draft: { brand: "Example", name: "Drink", packSize: "330 ml", energyKcal: 40, proteinPer100g: 0, fatPer100g: 0, carbohydratesPer100g: 9, sugarPer100g: 8.5, fieldConfidence: confidence },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unreadable is a valid terminal response and malformed provider output stays generic", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => providerJson({ outcome: "unreadable" });
  try {
    assert.deepEqual(await extractNutritionLabelWithGemini(request, env, performance.now()), { outcome: "unreadable" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => providerJson({ outcome: "nutrition_label", draft: { name: "Leaked text" } });
  try {
    await assert.rejects(
      extractNutritionLabelWithGemini(request, env, performance.now()),
      (error: unknown) => error instanceof NutritionLabelRequestError && error.code === "invalid_provider_response" && !error.message.includes("Leaked text"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
