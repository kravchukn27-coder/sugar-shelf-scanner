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
  window: { startsAt: string; endsAt: string; previousStartsAt: string; allTime: boolean };
  metrics: DashboardMetric[];
  funnel: DashboardFunnelStep[];
  users: DashboardUniqueUsers;
  stripe: StripeFinancialSummary[];
  operations: DashboardOperations;
  quality: { label: string; value: number }[];
  recentEvents: { occurredAt: string; eventName: string; source: string }[];
  cloudBilling: CloudBillingSummary;
  geminiHealth: GeminiHealth;
  guardRejections: GuardRejection[];
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

export type GeminiHealthDay = { day: string; requests: number; errors: number; timeoutErrors: number; p95LatencyMs: number | null; p95QueueMs: number | null; totalTokens: number; estimatedCostUsd: number | null };
export type GeminiHealthModel = { model: string; operation: string; requests: number; errors: number; timeoutErrors: number; successRate: number | null; p50LatencyMs: number | null; p95LatencyMs: number | null; totalTokens: number; estimatedCostUsd: number | null };
export type GeminiHealthOperation = { operation: string; requests: number; errors: number; timeoutErrors: number; p50LatencyMs: number | null; p95LatencyMs: number | null; p95QueueMs: number | null };
export type GeminiHealthDayOperation = { day: string; operation: string; requests: number; successes: number; timeoutErrors: number; p50LatencyMs: number | null; p95LatencyMs: number | null; p95QueueMs: number | null };
export type ScannerRoutePerformance = { route: string; requests: number; errors: number; p95DurationMs: number | null; p95VisionMs: number | null; p95CatalogMs: number | null };
export type ScannerExperiencePerformance = { completions: number; p95CaptureReadyMs: number | null; p95FirstPreflightDispatchMs: number | null; p95PreflightRttMs: number | null; p95AnalyzeRttMs: number | null; p95RenderMs: number | null };
export type ScannerExperienceDay = { day: string; completions: number; p95FirstPreflightDispatchMs: number | null; p95PreflightRttMs: number | null; p95AnalyzeRttMs: number | null };
export type HistoricalGeminiComparison = { period: string; requests: number; successRate: number; preflightP50Ms: string; preflightTimeoutRate: number; note: string };
export type GeminiHealth = { days: GeminiHealthDay[]; models: GeminiHealthModel[]; operations: GeminiHealthOperation[]; dailyOperations: GeminiHealthDayOperation[]; historicalComparisons: HistoricalGeminiComparison[]; routes: ScannerRoutePerformance[]; experience: ScannerExperiencePerformance; dailyExperience: ScannerExperienceDay[] };
/** Aggregate protection decisions only; no client identity or request contents. */
export type GuardRejection = { scope: string; guard: string; dimension: string | null; current: number; previous: number };

type MetricRow = { key: DashboardMetricKey; current_value: number | string | null; previous_value: number | string | null };
type QualityRow = { label: string; value: number | string | null };
type EventRow = { occurred_at: string | Date; event_name: string; source: string };
type StripeRow = { currency: string | null; paid_checkout_sessions: number | string | null; refunded_payments: number | string | null; gross_minor: number | string | null; refunded_minor: number | string | null };
type OperationsRow = { vision_requests: number | string | null; vision_errors: number | string | null; vision_p95_ms: number | string | null };
type UniqueUsersRow = { day: number | string | null; week: number | string | null; month: number | string | null };
type GeminiRequestDayRow = { day: string | Date; requests: number | string | null; errors: number | string | null; timeout_errors: number | string | null; p95_latency_ms: number | string | null; p95_queue_ms: number | string | null };
type GeminiUsageDayRow = { day: string | Date; total_tokens: number | string | null; estimated_cost_usd: number | string | null };
type GeminiRequestModelRow = { model: string | null; operation: string | null; requests: number | string | null; errors: number | string | null; timeout_errors: number | string | null; p50_latency_ms: number | string | null; p95_latency_ms: number | string | null };
type GeminiUsageModelRow = { model: string | null; operation: string | null; total_tokens: number | string | null; estimated_cost_usd: number | string | null };
type GeminiOperationRow = { operation: string | null; requests: number | string | null; errors: number | string | null; timeout_errors: number | string | null; p50_latency_ms: number | string | null; p95_latency_ms: number | string | null; p95_queue_ms: number | string | null };
type GeminiDayOperationRow = { day: string | Date; operation: string | null; requests: number | string | null; successes: number | string | null; timeout_errors: number | string | null; p50_latency_ms: number | string | null; p95_latency_ms: number | string | null; p95_queue_ms: number | string | null };
type ScannerRouteRow = { route: string | null; requests: number | string | null; errors: number | string | null; p95_duration_ms: number | string | null; p95_vision_ms: number | string | null; p95_catalog_ms: number | string | null };
type ScannerExperienceRow = { completions: number | string | null; p95_capture_ready_ms: number | string | null; p95_first_preflight_dispatch_ms: number | string | null; p95_preflight_rtt_ms: number | string | null; p95_analyze_rtt_ms: number | string | null; p95_render_ms: number | string | null };
type ScannerExperienceDayRow = { day: string | Date; completions: number | string | null; p95_first_preflight_dispatch_ms: number | string | null; p95_preflight_rtt_ms: number | string | null; p95_analyze_rtt_ms: number | string | null };
type GuardRejectionRow = { scope: string | null; guard: string | null; dimension: string | null; current_value: number | string | null; previous_value: number | string | null };

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

/**
 * Aggregates transcribed from the Railway log investigation on 2026-08-30.
 * Railway no longer retains the individual records for these windows, so p95
 * values, queue time, and operation-level splits must remain unavailable.
 */
const HISTORICAL_GEMINI_COMPARISONS: HistoricalGeminiComparison[] = [
  { period: "Aug 26–27 · healthy baseline", requests: 291, successRate: 0.811, preflightP50Ms: "2.7 s", preflightTimeoutRate: 0.124, note: "Archived Railway summary" },
  { period: "Aug 27–28 · Gemini incident", requests: 103, successRate: 0.437, preflightP50Ms: "4.8 s", preflightTimeoutRate: 0.427, note: "Archived Railway summary" },
  { period: "Aug 29", requests: 43, successRate: 0.79, preflightP50Ms: "2.4 s", preflightTimeoutRate: 0.074, note: "Archived Railway summary" },
  { period: "Aug 30 · partial day", requests: 11, successRate: 0.91, preflightP50Ms: "4.0–4.5 s", preflightTimeoutRate: 1 / 6, note: "Small sample · archived summary" },
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
  windowHours: number | null = 24,
  cloudBilling: CloudBillingSummary = { state: "not_configured", currency: null, actualGoogleLast24Hours: null, actualGoogleLast30Days: null, geminiLast24Hours: null, geminiLast30Days: null, latestUsageAt: null },
): Promise<DashboardOverview> {
  const endsAt = now;
  const allTime = windowHours === null;
  const startsAt = allTime ? new Date(0) : new Date(endsAt.getTime() - windowHours * 3_600_000);
  const previousStartsAt = allTime ? startsAt : new Date(startsAt.getTime() - windowHours * 3_600_000);

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

  const weekStartsAt = new Date(endsAt.getTime() - 7 * 86_400_000);
  const [geminiRequestDays, geminiUsageDays, geminiRequestModels, geminiUsageModels, geminiOperations, geminiDailyOperations, scannerRoutes, scannerExperience, scannerDailyExperience, guardRejections] = await Promise.all([
    db.query<GeminiRequestDayRow>(`
      SELECT date_trunc('day', occurred_at) AS day, COUNT(*)::bigint AS requests,
        COUNT(*) FILTER (WHERE COALESCE(properties->>'outcome', 'success') <> 'success')::bigint AS errors,
        COUNT(*) FILTER (WHERE properties->>'outcome' = 'provider_timeout')::bigint AS timeout_errors,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric) FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+$') AS p95_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'queueMs')::numeric) FILTER (WHERE properties->>'queueMs' ~ '^[0-9]+$') AS p95_queue_ms
      FROM analytics_events WHERE event_name = 'vision_request' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz GROUP BY 1 ORDER BY 1 ASC
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<GeminiUsageDayRow>(`
      SELECT date_trunc('day', occurred_at) AS day, COALESCE(SUM(NULLIF(properties->>'totalTokenCount', '')::numeric), 0) AS total_tokens,
        SUM(NULLIF(properties->>'estimatedCostUsd', '')::numeric) AS estimated_cost_usd
      FROM analytics_events WHERE event_name = 'vision_usage' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz GROUP BY 1 ORDER BY 1 ASC
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<GeminiRequestModelRow>(`
      SELECT COALESCE(NULLIF(properties->>'model', ''), 'unknown') AS model,
        COALESCE(NULLIF(properties->>'operation', ''), 'unknown') AS operation, COUNT(*)::bigint AS requests,
        COUNT(*) FILTER (WHERE COALESCE(properties->>'outcome', 'success') <> 'success')::bigint AS errors,
        COUNT(*) FILTER (WHERE properties->>'outcome' = 'provider_timeout')::bigint AS timeout_errors,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric) FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+$') AS p50_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric) FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+$') AS p95_latency_ms
      FROM analytics_events WHERE event_name = 'vision_request' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz GROUP BY 1, 2 ORDER BY requests DESC, model ASC, operation ASC
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<GeminiUsageModelRow>(`
      SELECT COALESCE(NULLIF(properties->>'model', ''), 'unknown') AS model,
        COALESCE(NULLIF(properties->>'operation', ''), 'unknown') AS operation,
        COALESCE(SUM(NULLIF(properties->>'totalTokenCount', '')::numeric), 0) AS total_tokens,
        SUM(NULLIF(properties->>'estimatedCostUsd', '')::numeric) AS estimated_cost_usd
      FROM analytics_events WHERE event_name = 'vision_usage' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz GROUP BY 1, 2
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<GeminiOperationRow>(`
      SELECT COALESCE(NULLIF(properties->>'operation', ''), 'unknown') AS operation, COUNT(*)::bigint AS requests,
        COUNT(*) FILTER (WHERE COALESCE(properties->>'outcome', 'success') <> 'success')::bigint AS errors,
        COUNT(*) FILTER (WHERE properties->>'outcome' = 'provider_timeout')::bigint AS timeout_errors,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric) FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p50_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric) FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'queueMs')::numeric) FILTER (WHERE properties->>'queueMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_queue_ms
      FROM analytics_events WHERE event_name = 'vision_request' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
      GROUP BY 1 ORDER BY requests DESC, operation ASC
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<GeminiDayOperationRow>(`
      SELECT date_trunc('day', occurred_at) AS day, COALESCE(NULLIF(properties->>'operation', ''), 'unknown') AS operation,
        COUNT(*)::bigint AS requests,
        COUNT(*) FILTER (WHERE COALESCE(properties->>'outcome', 'success') = 'success')::bigint AS successes,
        COUNT(*) FILTER (WHERE properties->>'outcome' = 'provider_timeout')::bigint AS timeout_errors,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric) FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p50_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric) FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'queueMs')::numeric) FILTER (WHERE properties->>'queueMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_queue_ms
      FROM analytics_events WHERE event_name = 'vision_request' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
      GROUP BY 1, 2 ORDER BY day DESC, operation ASC
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<ScannerRouteRow>(`
      SELECT COALESCE(NULLIF(properties->>'route', ''), 'unknown') AS route, COUNT(*)::bigint AS requests,
        COUNT(*) FILTER (WHERE properties->>'status' ~ '^[0-9]+$' AND (properties->>'status')::integer >= 400)::bigint AS errors,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'durationMs')::numeric) FILTER (WHERE properties->>'durationMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_duration_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'visionMs')::numeric) FILTER (WHERE properties->>'visionMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_vision_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'catalogMs')::numeric) FILTER (WHERE properties->>'catalogMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_catalog_ms
      FROM analytics_events WHERE event_name = 'scan_request' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
      GROUP BY 1 ORDER BY requests DESC, route ASC
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<ScannerExperienceRow>(`
      SELECT COUNT(*)::bigint AS completions,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'captureReadyMs')::numeric) FILTER (WHERE properties->>'captureReadyMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_capture_ready_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'timeToFirstPreflightDispatchMs')::numeric) FILTER (WHERE properties->>'timeToFirstPreflightDispatchMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_first_preflight_dispatch_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'preflightLastRttMs')::numeric) FILTER (WHERE properties->>'preflightLastRttMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_preflight_rtt_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'analyzeRttMs')::numeric) FILTER (WHERE properties->>'analyzeRttMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_analyze_rtt_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'renderMs')::numeric) FILTER (WHERE properties->>'renderMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_render_ms
      FROM analytics_events WHERE event_name = 'scanner_completed' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<ScannerExperienceDayRow>(`
      SELECT date_trunc('day', occurred_at) AS day, COUNT(*)::bigint AS completions,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'timeToFirstPreflightDispatchMs')::numeric) FILTER (WHERE properties->>'timeToFirstPreflightDispatchMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_first_preflight_dispatch_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'preflightLastRttMs')::numeric) FILTER (WHERE properties->>'preflightLastRttMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_preflight_rtt_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (properties->>'analyzeRttMs')::numeric) FILTER (WHERE properties->>'analyzeRttMs' ~ '^[0-9]+(\\.[0-9]+)?$') AS p95_analyze_rtt_ms
      FROM analytics_events WHERE event_name = 'scanner_completed' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
      GROUP BY 1 ORDER BY day DESC
    `, [weekStartsAt.toISOString(), endsAt.toISOString()]),
    db.query<GuardRejectionRow>(`
      SELECT COALESCE(NULLIF(properties->>'scope', ''), 'unknown') AS scope,
        COALESCE(NULLIF(properties->>'guard', ''), 'unknown') AS guard,
        NULLIF(properties->>'dimension', '') AS dimension,
        COUNT(*) FILTER (WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz)::bigint AS current_value,
        COUNT(*) FILTER (WHERE occurred_at >= $3::timestamptz AND occurred_at < $1::timestamptz)::bigint AS previous_value
      FROM analytics_events
      WHERE event_name = 'guard_rejection' AND occurred_at >= $3::timestamptz AND occurred_at < $2::timestamptz
      GROUP BY 1, 2, 3 ORDER BY current_value DESC, scope ASC, guard ASC
    `, [startsAt.toISOString(), endsAt.toISOString(), previousStartsAt.toISOString()]),
  ]);

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
  const usageByDay = new Map(geminiUsageDays.rows.map((row) => [new Date(row.day).toISOString().slice(0, 10), row]));
  const requestByDay = new Map(geminiRequestDays.rows.map((row) => [new Date(row.day).toISOString().slice(0, 10), row]));
  const geminiDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(Date.UTC(endsAt.getUTCFullYear(), endsAt.getUTCMonth(), endsAt.getUTCDate() - (6 - index))).toISOString().slice(0, 10);
    const request = requestByDay.get(day); const usage = usageByDay.get(day);
    return { day, requests: numeric(request?.requests ?? null), errors: numeric(request?.errors ?? null), timeoutErrors: numeric(request?.timeout_errors ?? null), p95LatencyMs: request?.p95_latency_ms === null || request?.p95_latency_ms === undefined ? null : numeric(request.p95_latency_ms), p95QueueMs: request?.p95_queue_ms === null || request?.p95_queue_ms === undefined ? null : numeric(request.p95_queue_ms), totalTokens: numeric(usage?.total_tokens ?? null), estimatedCostUsd: usage?.estimated_cost_usd === null || usage?.estimated_cost_usd === undefined ? null : numeric(usage.estimated_cost_usd) };
  });
  // Keyed by model+operation, not just model: the same model has very
  // different latency/success characteristics on a cheap preflight gate vs a
  // full analyze call, and averaging them together hid exactly the signal
  // this breakdown exists to show -- now also what the circuit breaker (see
  // GEMINI_PREFLIGHT_MODEL_FALLBACK / GEMINI_ANALYZE_MODEL_FALLBACK,
  // src/lib/observability/circuit-breaker.ts) is failing over between.
  const usageByModel = new Map(geminiUsageModels.rows.map((row) => [`${row.model ?? "unknown"}:${row.operation ?? "unknown"}`, row]));
  const geminiModels = geminiRequestModels.rows.map((row) => {
    const model = row.model ?? "unknown";
    const operation = row.operation ?? "unknown";
    const usage = usageByModel.get(`${model}:${operation}`);
    const requests = numeric(row.requests);
    const errors = numeric(row.errors);
    return {
      model,
      operation,
      requests,
      errors,
      timeoutErrors: numeric(row.timeout_errors),
      successRate: requests ? (requests - errors) / requests : null,
      p50LatencyMs: row.p50_latency_ms === null || row.p50_latency_ms === undefined ? null : numeric(row.p50_latency_ms),
      p95LatencyMs: row.p95_latency_ms === null || row.p95_latency_ms === undefined ? null : numeric(row.p95_latency_ms),
      totalTokens: numeric(usage?.total_tokens ?? null),
      estimatedCostUsd: usage?.estimated_cost_usd === null || usage?.estimated_cost_usd === undefined ? null : numeric(usage.estimated_cost_usd),
    };
  });
  const optional = (value: number | string | null | undefined) => value === null || value === undefined ? null : numeric(value);
  const experienceRow = scannerExperience.rows[0];
  return {
    generatedAt: now.toISOString(),
    window: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), previousStartsAt: previousStartsAt.toISOString(), allTime },
    metrics: dashboardMetrics,
    funnel,
    users: { day: numeric(usersRow?.day ?? null), week: numeric(usersRow?.week ?? null), month: numeric(usersRow?.month ?? null) },
    stripe: stripe.rows.map((row) => ({ currency: row.currency?.toUpperCase() || "UNKNOWN", paidCheckoutSessions: numeric(row.paid_checkout_sessions), refundedPayments: numeric(row.refunded_payments), grossMinor: numeric(row.gross_minor), refundedMinor: numeric(row.refunded_minor), netMinor: numeric(row.gross_minor) - numeric(row.refunded_minor) })),
    operations: { visionRequests, visionErrors, visionErrorRate: ratio(visionErrors, visionRequests), visionP95Ms: operationsRow?.vision_p95_ms === null || operationsRow?.vision_p95_ms === undefined ? null : numeric(operationsRow.vision_p95_ms) },
    quality: quality.rows.map((row) => ({ label: row.label, value: numeric(row.value) })),
    recentEvents: recent.rows.map((row) => ({ occurredAt: new Date(row.occurred_at).toISOString(), eventName: row.event_name, source: row.source })),
    cloudBilling,
    guardRejections: guardRejections.rows.map((row) => ({ scope: row.scope ?? "unknown", guard: row.guard ?? "unknown", dimension: row.dimension, current: numeric(row.current_value), previous: numeric(row.previous_value) })),
    geminiHealth: {
      days: geminiDays,
      models: geminiModels,
      operations: geminiOperations.rows.map((row) => ({ operation: row.operation ?? "unknown", requests: numeric(row.requests), errors: numeric(row.errors), timeoutErrors: numeric(row.timeout_errors), p50LatencyMs: optional(row.p50_latency_ms), p95LatencyMs: optional(row.p95_latency_ms), p95QueueMs: optional(row.p95_queue_ms) })),
      dailyOperations: geminiDailyOperations.rows.map((row) => ({ day: new Date(row.day).toISOString().slice(0, 10), operation: row.operation ?? "unknown", requests: numeric(row.requests), successes: numeric(row.successes), timeoutErrors: numeric(row.timeout_errors), p50LatencyMs: optional(row.p50_latency_ms), p95LatencyMs: optional(row.p95_latency_ms), p95QueueMs: optional(row.p95_queue_ms) })),
      historicalComparisons: HISTORICAL_GEMINI_COMPARISONS,
      routes: scannerRoutes.rows.map((row) => ({ route: row.route ?? "unknown", requests: numeric(row.requests), errors: numeric(row.errors), p95DurationMs: optional(row.p95_duration_ms), p95VisionMs: optional(row.p95_vision_ms), p95CatalogMs: optional(row.p95_catalog_ms) })),
      experience: { completions: numeric(experienceRow?.completions ?? null), p95CaptureReadyMs: optional(experienceRow?.p95_capture_ready_ms), p95FirstPreflightDispatchMs: optional(experienceRow?.p95_first_preflight_dispatch_ms), p95PreflightRttMs: optional(experienceRow?.p95_preflight_rtt_ms), p95AnalyzeRttMs: optional(experienceRow?.p95_analyze_rtt_ms), p95RenderMs: optional(experienceRow?.p95_render_ms) },
      dailyExperience: scannerDailyExperience.rows.map((row) => ({ day: new Date(row.day).toISOString().slice(0, 10), completions: numeric(row.completions), p95FirstPreflightDispatchMs: optional(row.p95_first_preflight_dispatch_ms), p95PreflightRttMs: optional(row.p95_preflight_rtt_ms), p95AnalyzeRttMs: optional(row.p95_analyze_rtt_ms) })),
    },
  };
}
