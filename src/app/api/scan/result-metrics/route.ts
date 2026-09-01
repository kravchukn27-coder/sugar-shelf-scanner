import { anonymizeAnalyticsSubject } from "@/lib/analytics/subjects";
import { isScannerMetricsEnabled } from "@/lib/env";
import { logResultMetrics, resultMetricsEnvelopeSchema, resultMetricsSchema } from "@/lib/observability/result-metrics";

export const runtime = "nodejs";

function noStore(status = 204) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Receives one allowlisted funnel interaction. Browser installations are
 * represented only by a server-side HMAC digest; the raw local identifier is
 * neither logged nor written to PostgreSQL.
 */
export async function POST(request: Request) {
  // A stale browser bundle may post after a rollout is disabled. Make this a
  // silent no-op without reading, logging, or retaining its request body.
  if (!isScannerMetricsEnabled()) return noStore();

  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 2_048)) return noStore(400);

  const body = await request.json().catch(() => null);
  const envelope = resultMetricsEnvelopeSchema.safeParse(body);
  if (envelope.success) {
    logResultMetrics(envelope.data.metric, anonymizeAnalyticsSubject(envelope.data.anonymousId, process.env.ANALYTICS_SUBJECT_SECRET));
    return noStore();
  }

  // Accept the pre-installation-id contract during a rolling deploy. Those
  // events still contribute to counts, but cannot contribute to unique users.
  const legacyMetric = resultMetricsSchema.safeParse(body);
  if (!legacyMetric.success) return noStore(400);
  logResultMetrics(legacyMetric.data);
  return noStore();
}
