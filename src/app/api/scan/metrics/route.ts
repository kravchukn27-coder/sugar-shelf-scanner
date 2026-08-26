import { isScannerMetricsEnabled } from "@/lib/env";
import { logScannerMetrics, scannerMetricsSchema } from "@/lib/observability/scanner-metrics";

export const runtime = "nodejs";

function noStore(status = 204) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Receives one aggregate, terminal browser summary. It deliberately does not
 * write to PostgreSQL or log a request identifier; the caller's payload is
 * schema-restricted before the single safe aggregate event is emitted.
 */
export async function POST(request: Request) {
  // A stale browser bundle may post after a rollout is disabled. Make this a
  // silent no-op without reading, logging, or retaining its request body.
  if (!isScannerMetricsEnabled()) return noStore();

  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 2_048)) return noStore(400);

  const body = await request.json().catch(() => null);
  const parsed = scannerMetricsSchema.safeParse(body);
  if (!parsed.success) return noStore(400);

  logScannerMetrics(parsed.data);
  return noStore();
}
