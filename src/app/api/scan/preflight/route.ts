import { preflightScanRequestSchema, preflightScanResponseSchema } from "@/lib/contracts/scan";
import { getServerEnv } from "@/lib/env";
import { checkScanRateLimit, scanJsonResponse } from "@/lib/observability/scan-route";
import { preflightWithGemini, VisionRequestError } from "@/lib/vision/gemini";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const respond = (body: unknown, status: number, visionMs?: number) => scanJsonResponse(body, { status }, {
    route: "preflight",
    startedAt,
    status,
    visionMs,
  });
  const rateLimit = checkScanRateLimit(request, {
    scope: "preflight",
    limit: 90,
    windowMs: 60_000,
    secret: process.env.RATE_LIMIT_SECRET,
  });
  if (!rateLimit.allowed) {
    const response = respond({ error: "Too many scan attempts. Please wait a moment and try again.", code: "rate_limited" }, 429);
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const body = await request.json().catch(() => null);
  const parsed = preflightScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return respond({ error: "Invalid preflight request", issues: parsed.error.flatten() }, 400);
  }

  let env;
  try {
    env = getServerEnv();
  } catch {
    return respond({ error: "Vision service configuration is invalid." }, 503);
  }

  try {
    const visionStartedAt = performance.now();
    // A deterministic mock response keeps local UI work possible without a
    // Gemini key. It has no product identity or nutrition meaning.
    const response = env.VISION_PROVIDER === "gemini"
      ? await preflightWithGemini(parsed.data, env, startedAt, request.signal)
      : {
          clientFrameId: parsed.data.clientFrameId,
          provider: "mock" as const,
          decision: "candidate" as const,
          packagedProductCount: 1,
          confidence: 0.9,
          reasonCode: "packaged_food_or_drink" as const,
          analyzedAt: new Date().toISOString(),
        };
    return respond(preflightScanResponseSchema.parse(response), 200, performance.now() - visionStartedAt);
  } catch (error) {
    if (error instanceof VisionRequestError) {
      return respond({ error: error.message, code: error.code }, error.status);
    }
    return respond({ error: "Unable to preflight this frame.", code: "internal_error" }, 500);
  }
}
