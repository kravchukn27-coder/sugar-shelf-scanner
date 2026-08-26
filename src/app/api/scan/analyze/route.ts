import { analyzeScanRequestSchema, analyzeScanResponseSchema } from "@/lib/contracts/scan";
import { getServerEnv } from "@/lib/env";
import { getMockShelfScan } from "@/lib/mock/scan-fixtures";
import { checkScanRateLimit, scanJsonResponse } from "@/lib/observability/scan-route";
import { analyzeWithGemini, VisionRequestError } from "@/lib/vision/gemini";
import { resolveScan } from "@/lib/catalog/resolve-scan";
import { createRuntimeCatalog } from "@/lib/catalog/runtime-catalog";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const respond = (body: unknown, status: number, visionMs?: number, catalogMs?: number, dbProbeMs?: number, catalogResolutionMs?: number) => scanJsonResponse(body, { status }, {
    route: "analyze",
    startedAt,
    status,
    visionMs,
    catalogMs,
    dbProbeMs,
    catalogResolutionMs,
  });
  const rateLimit = checkScanRateLimit(request, {
    scope: "analyze",
    limit: 12,
    windowMs: 60_000,
    secret: process.env.RATE_LIMIT_SECRET,
  });
  if (!rateLimit.allowed) {
    const response = respond({ error: "Too many scans. Please wait a moment and try again.", code: "rate_limited" }, 429);
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const body = await request.json().catch(() => null);
  const parsed = analyzeScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return respond({ error: "Invalid scan request", issues: parsed.error.flatten() }, 400);
  }

  let env;
  try {
    env = getServerEnv();
  } catch {
    return respond({ error: "Vision service configuration is invalid." }, 503);
  }

  try {
    // The catalog DB probe (existence check) does not depend on the vision
    // result, so start it alongside the Gemini call instead of after it. A
    // rejection here must not become an unhandled rejection while the vision
    // call is still in flight; resolveScan is the one that awaits and
    // surfaces it for real.
    const dbProbeStartedAt = performance.now();
    let dbProbeMs: number | undefined;
    const catalogPromise = createRuntimeCatalog({
      databaseUrl: env.DATABASE_URL,
      usdaApiKey: env.USDA_FDC_API_KEY,
      openFoodFactsUserAgent: env.OPEN_FOOD_FACTS_USER_AGENT,
    }).then(
      (catalog) => {
        dbProbeMs = performance.now() - dbProbeStartedAt;
        return catalog;
      },
      (error: unknown) => {
        dbProbeMs = performance.now() - dbProbeStartedAt;
        throw error;
      },
    );
    catalogPromise.catch(() => {});

    const visionStartedAt = performance.now();
    const visionResponse = env.VISION_PROVIDER === "gemini"
      ? await analyzeWithGemini(parsed.data, env, startedAt)
      : getMockShelfScan(parsed.data.clientFrameId);
    const visionMs = performance.now() - visionStartedAt;
    const catalogStartedAt = performance.now();
    const response = await resolveScan(visionResponse, env, catalogPromise);
    const catalogResolutionMs = performance.now() - catalogStartedAt;
    // Preserve the existing `catalog` Server-Timing metric for consumers that
    // already read it, while exposing the explicit A1 stage alongside it.
    return respond(analyzeScanResponseSchema.parse(response), 200, visionMs, catalogResolutionMs, dbProbeMs, catalogResolutionMs);
  } catch (error) {
    if (error instanceof VisionRequestError) {
      return respond({ error: error.message, code: error.code }, error.status);
    }
    return respond({ error: "Unable to analyze this frame.", code: "internal_error" }, 500);
  }
}
