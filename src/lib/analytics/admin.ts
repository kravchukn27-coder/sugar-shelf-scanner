import { timingSafeEqual } from "node:crypto";

/**
 * Internal analytics access is deliberately independent from the consumer
 * session. The dashboard contains commercial and operational aggregates and
 * therefore must never be enabled by a public browser flag.
 */
export type AnalyticsEnvironment = { [key: string]: string | undefined };

export function isAnalyticsAdminRequest(request: Request, environment: AnalyticsEnvironment = process.env): boolean {
  const expected = environment.ANALYTICS_ADMIN_SECRET;
  if (!expected || expected.length < 16) return false;

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export function isAnalyticsDashboardConfigured(environment: AnalyticsEnvironment = process.env): boolean {
  return environment.ANALYTICS_ENABLED === "true" && Boolean(environment.DATABASE_URL) && Boolean(environment.ANALYTICS_ADMIN_SECRET);
}
