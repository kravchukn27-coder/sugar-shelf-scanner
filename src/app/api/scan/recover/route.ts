import { barcodeRecoveryRequestSchema, barcodeRecoveryResponseSchema } from "@/lib/contracts/scan";
import { getServerEnv } from "@/lib/env";
import { resolveBarcode } from "@/lib/catalog/resolve-scan";
import { checkScanRateLimit, scanJsonResponse } from "@/lib/observability/scan-route";

export const runtime = "nodejs";

/**
 * Barcode-only catalog recovery. This endpoint intentionally accepts neither
 * images nor OCR strings, so it cannot become a second Gemini analysis path.
 */
export async function POST(request: Request) {
  const startedAt = performance.now();
  const respond = (body: unknown, status: number) => scanJsonResponse(body, { status }, { route: "recovery_barcode", startedAt, status });
  const rateLimit = await checkScanRateLimit(request, {
    scope: "recovery_barcode",
    limit: 20,
    windowMs: 600_000,
    secret: process.env.RATE_LIMIT_SECRET,
  });
  if (!rateLimit.allowed) {
    if (rateLimit.unavailable) return respond({ error: "Scan protection is temporarily unavailable.", code: "rate_limiter_unavailable" }, 503);
    const response = respond({ error: "Too many barcode lookups. Please wait and try again.", code: "rate_limited" }, 429);
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }
  const body = await request.json().catch(() => null);
  const parsed = barcodeRecoveryRequestSchema.safeParse(body);
  if (!parsed.success) return respond({ error: "Invalid barcode recovery request" }, 400);
  try {
    const resolved = await resolveBarcode(parsed.data.gtin, getServerEnv());
    return respond(barcodeRecoveryResponseSchema.parse(resolved), 200);
  } catch {
    return respond({ error: "Barcode lookup is temporarily unavailable." }, 503);
  }
}
