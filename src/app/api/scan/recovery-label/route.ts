import { nutritionLabelRecoveryRequestSchema, nutritionLabelRecoveryResponseSchema } from "@/lib/contracts/scan";
import { getServerEnv } from "@/lib/env";
import { checkScanRateLimit, scanJsonResponse } from "@/lib/observability/scan-route";
import { extractNutritionLabelWithGemini, NutritionLabelRequestError } from "@/lib/recovery/nutrition-label";

export const runtime = "nodejs";

/**
 * One consented still-photo request. This route neither persists the image nor
 * creates a catalog product; only a later user-confirmed proposal enters the
 * pending-review queue.
 */
export async function POST(request: Request) {
  const startedAt = performance.now();
  const respond = (body: unknown, status: number) => scanJsonResponse(body, { status }, {
    route: "recovery_label",
    startedAt,
    status,
  });
  const rateLimit = await checkScanRateLimit(request, {
    scope: "recovery_label",
    limit: 5,
    windowMs: 60_000,
    secret: process.env.RATE_LIMIT_SECRET,
  });
  if (!rateLimit.allowed) {
    if (rateLimit.unavailable) return respond({ error: "Scan protection is temporarily unavailable.", code: "rate_limiter_unavailable" }, 503);
    const response = respond({ error: "Too many label photos. Please wait a moment and try again.", code: "rate_limited" }, 429);
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const body = await request.json().catch(() => null);
  const parsed = nutritionLabelRecoveryRequestSchema.safeParse(body);
  if (!parsed.success) return respond({ error: "A nutrition-label photo requires your consent.", code: "invalid_request" }, 400);

  let env;
  try {
    env = getServerEnv();
  } catch {
    return respond({ error: "Nutrition label reading is not configured.", code: "not_configured" }, 503);
  }
  if (env.VISION_PROVIDER !== "gemini") return respond({ error: "Nutrition label reading is not available in this environment.", code: "not_configured" }, 503);

  try {
    return respond(nutritionLabelRecoveryResponseSchema.parse(await extractNutritionLabelWithGemini(parsed.data, env, startedAt)), 200);
  } catch (error) {
    if (error instanceof NutritionLabelRequestError) return respond({ error: error.message, code: error.code }, error.status);
    return respond({ error: "Nutrition label reading is temporarily unavailable. Take another photo and try again.", code: "internal_error" }, 500);
  }
}
