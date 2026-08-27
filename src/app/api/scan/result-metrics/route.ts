import { isScannerMetricsEnabled } from "@/lib/env";
import { logResultMetrics, resultMetricsSchema } from "@/lib/observability/result-metrics";

export const runtime = "nodejs";

function noStore(status = 204) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Receives one privacy-safe aggregate funnel interaction. The endpoint stores
 * no rows and does not log a request identifier; only a schema-validated
 * allowlisted event can reach stdout.
 */
export async function POST(request: Request) {
  // A stale browser bundle may post after a rollout is disabled. Make this a
  // silent no-op without reading, logging, or retaining its request body.
  if (!isScannerMetricsEnabled()) return noStore();

  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 2_048)) return noStore(400);

  const body = await request.json().catch(() => null);
  const parsed = resultMetricsSchema.safeParse(body);
  if (!parsed.success) return noStore(400);

  logResultMetrics(parsed.data);
  return noStore();
}
