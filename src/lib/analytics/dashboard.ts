import type { SqlQueryExecutor } from "@/lib/catalog/repository";
import type { CloudBillingSummary } from "@/lib/analytics/cloud-billing";

export type DashboardMetricKey =
  | "scan_started"
  | "result_shown"
  | "paywall_shown"
  | "paywall_checkout_started"
  | "access_granted"
  | "stripe_checkout_completed"
  | "vision_requests"
  | "vision_errors"
  | "gemini_total_tokens"
  | "gemini_estimated_cost_usd";

export type DashboardMetric = {
  key: DashboardMetricKey;
  label: string;
  value: number | null;
  previousValue: number | null;
  unit: "count" | "usd";
};

export type DashboardOverview = {
  generatedAt: string;
  window: { startsAt: string; endsAt: string; previousStartsAt: string };
  metrics: DashboardMetric[];
  funnel: DashboardFunnelStep[];
  users: DashboardUniqueUsers;
  stripe: StripeFinancialSummary[];
  operations: DashboardOperations;
  quality: { label: string; value: number }[];
  recentEvents: { occurredAt: string; eventName: string; source: string }[];
  cloudBilling: CloudBillingSummary;
};

export type DashboardFunnelStep = {
  label: string;
  numerator: number;
  denominator: number;
  rate: number | null;
  previousRate: number | null;
};

/** Distinct pseudonymous browser installations, not authenticated people. */
export type DashboardUniqueUsers = { day: number; week: number; month: number };

/** Monetary values are integer minor units. Currencies never get silently converted or combined. */
export type StripeFinancialSummary = {
  currency: string;
  paidCheckoutSessions: number;
  refundedPayments: number;
  grossMinor: number;
  refundedMinor: number;
  netMinor: number;
};

export type DashboardOperations = {
  visionRequests: number;
  visionErrors: number;
  visionErrorRate: number | null;
  visionP95Ms: number | null;
};

type MetricRow = { key: DashboardMetricKey; current_value: number | string | null; previous_value: number | string | null };
type QualityRow = { label: string; value: number | string | null };
type EventRow = { occurred_at: string | Date; event_name: string; source: string };
type StripeRow = { currency: string | null; paid_checkout_sessions: number | string | null; refunded_payments: number | string | null; gross_minor: number | string | null; refunded_minor: number | string | null };
type OperationsRow = { vision_requests: number | string | null; vision_errors: number | string | null; vision_p95_ms: number | string | null };
type UniqueUsersRow = { day: number | string | null; week: number | string | null; month: number | string | null };

const METRICS: { key: DashboardMetricKey; label: string; unit: DashboardMetric["unit"] }[] = [
  { key: "scan_started", label: "Scans started", unit: "count" },
  { key: "result_shown", label: "Results shown", unit: "count" },
  { key: "paywall_shown", label: "Paywall shown", unit: "count" },
  { key: "paywall_checkout_started", label: "Checkout started", unit: "count" },
  { key: "access_granted", label: "Access granted", unit: "count" },
  { key: "stripe_checkout_completed", label: "Stripe payments", unit: "count" },
  { key: "vision_requests", label: "Gemini requests", unit: "count" },
  { key: "vision_errors", label: "Gemini errors", unit: "count" },
  { key: "gemini_total_tokens", label: "Gemini tokens", unit: "count" },
  { key: "gemini_estimated_cost_usd", label: "Estimated Gemini cost", unit: "usd" },
];

function numeric(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Read-only overview over the event contract introduced by migration 007.
 *
 * Metric-specific properties are intentionally decoded only inside SQL: the
 * client receives aggregates and a small event feed, never event payloads.
 * The Gemini cost is the application estimate emitted with the request; it is
 * not a substitute for the later Cloud Billing reconciliation.
 */
export async function readDashboardOverview(
  db: SqlQueryExecutor,
  now: Date = new Date(),
  windowHours = 24,
  cloudBilling: CloudBillingSummary = { state: "not_configured", currency: null, actualGoogleLast24Hours: null, actualGoogleLast30Days: null, geminiLast24Hours: null, geminiLast30Days: null, latestUsageAt: null },
): Promise<DashboardOverview> {
  const endsAt = now;
  const startsAt = new Date(endsAt.getTime() - windowHours * 3_600_000);
  const previousStartsAt = new Date(startsAt.getTime() - windowHours * 3_600_000);

  const metrics = await db.query<MetricRow>(`
    WITH metric_events AS (
      SELECT 'scan_started' AS key, occurred_at, 1::numeric AS value FROM analytics_events
        WHERE event_name = 'scan_result_metric' AND properties->>'action' = 'scan_started'
      UNION ALL SELECT 'result_shown', occurred_at, 1 FROM analytics_events
        WHERE event_name = 'scan_result_metric' AND properties->>'action' = 'result_shown'
      UNION ALL SELECT 'paywall_shown', occurred_at, 1 FROM analytics_events
        WHERE event_name = 'scan_result_metric' AND properties->>'action' = 'paywall_shown'
      UNION ALL SELECT 'paywall_checkout_started', occurred_at, 1 FROM analytics_events
        WHERE event_name = 'scan_result_metric' AND properties->>'action' = 'paywall_checkout_started'
      UNION ALL SELECT 'access_granted', occurred_at, 1 FROM analytics_events
        WHERE event_name = 'scan_result_metric' AND properties->>'action' = 'access_granted'
      UNION ALL SELECT 'vision_requests', occurred_at, 1 FROM analytics_events
        WHERE event_name = 'vision_request'
      UNION ALL SELECT 'vision_errors', occurred_at, 1 FROM analytics_events
        WHERE event_name = 'vision_request' AND COALESCE(properties->>'outcome', 'success') <> 'success'
      UNION ALL SELECT 'gemini_total_tokens', occurred_at, COALESCE(NULLIF(properties->>'totalTokenCount', '')::numeric, 0) FROM analytics_events
        WHERE event_name = 'vision_usage'
      UNION ALL SELECT 'gemini_estimated_cost_usd', occurred_at, NULLIF(properties->>'estimatedCostUsd', '')::numeric FROM analytics_events
        WHERE event_name = 'vision_usage' AND properties ? 'estimatedCostUsd'
      UNION ALL SELECT 'stripe_checkout_completed', event_created_at, 1 FROM stripe_payment_ledger
        WHERE event_type IN ('checkout.session.completed', 'checkout.session.async_payment_succeeded') AND payment_status = 'paid'
    )
    SELECT key,
      COALESCE(SUM(value) FILTER (WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz), 0) AS current_value,
      COALESCE(SUM(value) FILTER (WHERE occurred_at >= $3::timestamptz AND occurred_at < $1::timestamptz), 0) AS previous_value
    FROM metric_events
    WHERE occurred_at >= $3::timestamptz AND occurred_at < $2::timestamptz
    GROUP BY key
  `, [startsAt.toISOString(), endsAt.toISOString(), previousStartsAt.toISOString()]);

  const quality = await db.query<QualityRow>(`
    SELECT COALESCE(properties->>'resultQuality', 'unknown') AS label, COUNT(*) AS value
    FROM analytics_events
    WHERE event_name = 'scan_result_metric'
      AND properties->>'action' = 'result_shown'
      AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
    GROUP BY COALESCE(properties->>'resultQuality', 'unknown')
    ORDER BY value DESC, label ASC
  `, [startsAt.toISOString(), endsAt.toISOString()]);

  const stripe = await db.query<StripeRow>(`
    WITH paid AS (
      SELECT DISTINCT ON (checkout_session_id)
        checkout_session_id, currency, amount_total
      FROM stripe_payment_ledger
      WHERE event_type IN ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
        AND payment_status = 'paid' AND checkout_session_id IS NOT NULL
        AND event_created_at >= $1::timestamptz AND event_created_at < $2::timestamptz
      ORDER BY checkout_session_id, event_created_at DESC
    ), refunded AS (
      SELECT DISTINCT ON (COALESCE(payment_intent_id, stripe_event_id))
        COALESCE(payment_intent_id, stripe_event_id) AS refund_key, currency, amount_refunded
      FROM stripe_payment_ledger
      WHERE event_type = 'charge.refunded'
        AND event_created_at >= $1::timestamptz AND event_created_at < $2::timestamptz
      ORDER BY COALESCE(payment_intent_id, stripe_event_id), event_created_at DESC
    ), totals AS (
      SELECT COALESCE(currency, 'unknown') AS currency, COUNT(*)::bigint AS paid_checkout_sessions, 0::bigint AS refunded_payments,
        COALESCE(SUM(amount_total), 0)::bigint AS gross_minor, 0::bigint AS refunded_minor FROM paid GROUP BY COALESCE(currency, 'unknown')
      UNION ALL
      SELECT COALESCE(currency, 'unknown'), 0, COUNT(*)::bigint, 0, COALESCE(SUM(amount_refunded), 0)::bigint FROM refunded GROUP BY COALESCE(currency, 'unknown')
    ) SELECT currency, SUM(paid_checkout_sessions)::bigint AS paid_checkout_sessions, SUM(refunded_payments)::bigint AS refunded_payments,
      SUM(gross_minor)::bigint AS gross_minor, SUM(refunded_minor)::bigint AS refunded_minor
    FROM totals GROUP BY currency ORDER BY currency ASC
  `, [startsAt.toISOString(), endsAt.toISOString()]);

  const operations = await db.query<OperationsRow>(`
    SELECT COUNT(*)::bigint AS vision_requests,
      COUNT(*) FILTER (WHERE COALESCE(properties->>'outcome', 'success') <> 'success')::bigint AS vision_errors,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric)
        FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+$') AS vision_p95_ms
    FROM analytics_events
    WHERE event_name = 'vision_request' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
  `, [startsAt.toISOString(), endsAt.toISOString()]);

  const recent = await db.query<EventRow>(`
    SELECT occurred_at, event_name, source
    FROM analytics_events
    WHERE occurred_at >= $1::timestamptz
    ORDER BY occurred_at DESC
    LIMIT 12
  `, [startsAt.toISOString()]);

  const uniqueUsers = await db.query<UniqueUsersRow>(`
    SELECT
      COUNT(DISTINCT subject_hash) FILTER (WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz)::bigint AS day,
      COUNT(DISTINCT subject_hash) FILTER (WHERE occurred_at >= $3::timestamptz AND occurred_at < $2::timestamptz)::bigint AS week,
      COUNT(DISTINCT subject_hash) FILTER (WHERE occurred_at >= $4::timestamptz AND occurred_at < $2::timestamptz)::bigint AS month
    FROM analytics_events
    WHERE subject_hash IS NOT NULL AND occurred_at >= $4::timestamptz AND occurred_at < $2::timestamptz
  `, [startsAt.toISOString(), endsAt.toISOString(), new Date(endsAt.getTime() - 7 * 86_400_000).toISOString(), new Date(endsAt.getTime() - 30 * 86_400_000).toISOString()]);

  const byKey = new Map(metrics.rows.map((row) => [row.key, row]));
  const dashboardMetrics = METRICS.map((definition) => {
    const row = byKey.get(definition.key);
    const unpriced = definition.key === "gemini_estimated_cost_usd" && !row;
    return { ...definition, value: unpriced ? null : numeric(row?.current_value ?? null), previousValue: unpriced ? null : numeric(row?.previous_value ?? null) };
  });
  const valueFor = (key: DashboardMetricKey, previous = false) => numeric(byKey.get(key)?.[previous ? "previous_value" : "current_value"] ?? null);
  const funnel = [
    { label: "Scan → result", numerator: valueFor("result_shown"), denominator: valueFor("scan_started"), previousNumerator: valueFor("result_shown", true), previousDenominator: valueFor("scan_started", true) },
    { label: "Paywall → checkout", numerator: valueFor("paywall_checkout_started"), denominator: valueFor("paywall_shown"), previousNumerator: valueFor("paywall_checkout_started", true), previousDenominator: valueFor("paywall_shown", true) },
    { label: "Checkout → access", numerator: valueFor("access_granted"), denominator: valueFor("paywall_checkout_started"), previousNumerator: valueFor("access_granted", true), previousDenominator: valueFor("paywall_checkout_started", true) },
  ].map(({ label, numerator, denominator, previousNumerator, previousDenominator }) => ({ label, numerator, denominator, rate: ratio(numerator, denominator), previousRate: ratio(previousNumerator, previousDenominator) }));
  const operationsRow = operations.rows[0];
  const visionRequests = numeric(operationsRow?.vision_requests ?? null);
  const visionErrors = numeric(operationsRow?.vision_errors ?? null);
  const usersRow = uniqueUsers.rows[0];
  return {
    generatedAt: now.toISOString(),
    window: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), previousStartsAt: previousStartsAt.toISOString() },
    metrics: dashboardMetrics,
    funnel,
    users: { day: numeric(usersRow?.day ?? null), week: numeric(usersRow?.week ?? null), month: numeric(usersRow?.month ?? null) },
    stripe: stripe.rows.map((row) => ({ currency: row.currency?.toUpperCase() || "UNKNOWN", paidCheckoutSessions: numeric(row.paid_checkout_sessions), refundedPayments: numeric(row.refunded_payments), grossMinor: numeric(row.gross_minor), refundedMinor: numeric(row.refunded_minor), netMinor: numeric(row.gross_minor) - numeric(row.refunded_minor) })),
    operations: { visionRequests, visionErrors, visionErrorRate: ratio(visionErrors, visionRequests), visionP95Ms: operationsRow?.vision_p95_ms === null || operationsRow?.vision_p95_ms === undefined ? null : numeric(operationsRow.vision_p95_ms) },
    quality: quality.rows.map((row) => ({ label: row.label, value: numeric(row.value) })),
    recentEvents: recent.rows.map((row) => ({ occurredAt: new Date(row.occurred_at).toISOString(), eventName: row.event_name, source: row.source })),
    cloudBilling,
  };
}
