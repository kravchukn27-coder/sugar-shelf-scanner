import { Pool } from "pg";
import { isAnalyticsAdminRequest, isAnalyticsDashboardConfigured } from "@/lib/analytics/admin";
import { readDashboardOverview } from "@/lib/analytics/dashboard";
import { readCloudBillingSummary } from "@/lib/analytics/cloud-billing";
import { readBreakerStatus, type BreakerStatus } from "@/lib/observability/circuit-breaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analyticsPool = globalThis as typeof globalThis & { __sugarAnalyticsDashboardPool?: Pool };

function getPool(databaseUrl: string): Pool {
  return analyticsPool.__sugarAnalyticsDashboardPool ??= new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 1_500,
    query_timeout: 4_000,
  });
}

function response(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function readWindowHours(request: Request): number | null {
  const range = new URL(request.url).searchParams.get("range");
  if (range === "3d") return 72;
  if (range === "7d") return 168;
  if (range === "all") return null;
  return 24;
}

/** A browser never receives analytics data until it proves possession of the admin secret. */
export async function GET(request: Request) {
  if (!isAnalyticsDashboardConfigured()) return response({ error: "not_configured" }, 503);
  if (!isAnalyticsAdminRequest(request)) return response({ error: "unauthorized" }, 401);

  try {
    const [cloudBilling, breaker] = await Promise.all([
      readCloudBillingSummary(),
      readBreakerStatus(["preflight", "analyze"]).catch(() => ({}) as Record<string, BreakerStatus>),
    ]);
    const data = await readDashboardOverview(getPool(process.env.DATABASE_URL!), new Date(), readWindowHours(request), cloudBilling);
    return response({ ...data, breaker }, 200);
  } catch {
    // Keep database topology and query failures internal; the dashboard can
    // retry without pretending that zero is a valid live metric.
    return response({ error: "unavailable" }, 503);
  }
}
