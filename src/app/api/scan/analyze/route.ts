import { analyzeScanRequestSchema, analyzeScanResponseSchema } from "@/lib/contracts/scan";
import { getServerEnv } from "@/lib/env";
import { getMockShelfScan } from "@/lib/mock/scan-fixtures";
import { checkScanRateLimit, scanJsonResponse } from "@/lib/observability/scan-route";
import { analyzeWithGemini, VisionRequestError } from "@/lib/vision/gemini";
import { resolveScan } from "@/lib/catalog/resolve-scan";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const respond = (body: unknown, status: number, visionMs?: number, catalogMs?: number) => scanJsonResponse(body, { status }, {
    route: "analyze",
    startedAt,
    status,
    visionMs,
    catalogMs,
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
    const visionStartedAt = performance.now();
    const visionResponse = env.VISION_PROVIDER === "gemini"
      ? await analyzeWithGemini(parsed.data, env)
      : getMockShelfScan(parsed.data.clientFrameId);
    const visionMs = performance.now() - visionStartedAt;
    const catalogStartedAt = performance.now();
    const response = await resolveScan(visionResponse, env);
    const catalogMs = performance.now() - catalogStartedAt;
    return respond(analyzeScanResponseSchema.parse(response), 200, visionMs, catalogMs);
  } catch (error) {
    if (error instanceof VisionRequestError) {
      return respond({ error: error.message, code: error.code }, error.status);
    }
    return respond({ error: "Unable to analyze this frame.", code: "internal_error" }, 500);
  }
}
