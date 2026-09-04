import assert from "node:assert/strict";
import test from "node:test";
import { readDashboardOverview } from "./dashboard";
import type { SqlQueryExecutor } from "@/lib/catalog/repository";

// Matched by SQL text rather than call position: readGeminiHeadline runs the
// same 10 queries twice (once per window), so a positional counter can no
// longer identify which call is which -- and it kept needing a manual bump
// every time this file grew a new query anyway. Order matters: rules with a
// more specific match (e.g. day-bucketed variants) must come before the
// looser headline variants of the same query.
const RULES: Array<{ match: (sql: string) => boolean; rows: Record<string, unknown>[] }> = [
  { match: (sql) => sql.includes("metric_events"), rows: [{ key: "scan_started", current_value: "12", previous_value: "8" }] },
  { match: (sql) => sql.includes("resultQuality"), rows: [{ label: "mixed", value: "7" }] },
  { match: (sql) => sql.includes("paid_checkout_sessions"), rows: [{ currency: "eur", paid_checkout_sessions: "2", refunded_payments: "1", gross_minor: "998", refunded_minor: "499" }] },
  { match: (sql) => sql.includes("vision_p95_ms"), rows: [{ vision_requests: "10", vision_errors: "2", vision_p95_ms: "850" }] },
  { match: (sql) => sql.includes("LIMIT 12"), rows: [{ occurred_at: "2026-08-31T10:15:00.000Z", event_name: "vision_usage", source: "server" }] },
  { match: (sql) => sql.includes("subject_hash"), rows: [{ day: "4", week: "12", month: "28" }] },
  { match: (sql) => sql.includes("guard_rejection"), rows: [{ scope: "analyze", guard: "request_rate_limit", dimension: "installation", current_value: "3", previous_value: "1" }] },
  { match: (sql) => sql.includes("event_name = 'vision_request'") && sql.includes("GROUP BY 1 ORDER BY 1 ASC"), rows: [{ day: "2026-08-31T00:00:00Z", requests: "8", errors: "2", timeout_errors: "1", p95_latency_ms: "900", p95_queue_ms: "40" }] },
  { match: (sql) => sql.includes("event_name = 'vision_usage'") && sql.includes("GROUP BY 1 ORDER BY 1 ASC"), rows: [{ day: "2026-08-31T00:00:00Z", total_tokens: "1200", estimated_cost_usd: "0.02" }] },
  { match: (sql) => sql.includes("AS successes"), rows: [{ day: "2026-08-31T00:00:00Z", operation: "preflight", requests: "8", successes: "6", timeout_errors: "1", p50_latency_ms: "400", p95_latency_ms: "900", p95_queue_ms: "40" }] },
  { match: (sql) => sql.includes("scanner_completed") && sql.includes("date_trunc('day'"), rows: [{ day: "2026-08-31T00:00:00Z", completions: "6", p95_first_preflight_dispatch_ms: "330", p95_preflight_rtt_ms: "1100", p95_analyze_rtt_ms: "1600" }] },
  { match: (sql) => sql.includes("scan_request") && sql.includes("date_trunc('day'"), rows: [{ day: "2026-08-31T00:00:00Z", route: "preflight", requests: "7", errors: "1", p95_duration_ms: "1050", p95_vision_ms: "900", p95_catalog_ms: "60" }] },
  { match: (sql) => sql.includes("catalog_resolution") && sql.includes("outcomes") && sql.includes("date_trunc('day'"), rows: [{ day: "2026-08-31T00:00:00Z", confirmed: "3", estimate: "2", unknown: "1", total: "6" }] },
  { match: (sql) => sql.includes("catalog_resolution") && sql.includes("defaultConfidenceCount") && sql.includes("date_trunc('day'"), rows: [{ day: "2026-08-31T00:00:00Z", default_confidence_count: "2", total: "6" }] },
  { match: (sql) => sql.includes("event_name = 'vision_request'") && sql.includes("model"), rows: [{ model: "gemini-3.6-flash", operation: "preflight", requests: "8", errors: "2", timeout_errors: "1", p50_latency_ms: "400", p95_latency_ms: "900" }] },
  { match: (sql) => sql.includes("event_name = 'vision_usage'") && sql.includes("model"), rows: [{ model: "gemini-3.6-flash", operation: "preflight", total_tokens: "1200", estimated_cost_usd: "0.02" }] },
  { match: (sql) => sql.includes("hedge"), rows: [{ operation: "analyze", eligible: "5", won: "2" }] },
  { match: (sql) => sql.includes("event_name = 'vision_request'") && sql.includes("operation"), rows: [{ operation: "preflight", requests: "8", errors: "2", timeout_errors: "1", p50_latency_ms: "400", p95_latency_ms: "900", p95_queue_ms: "40" }] },
  { match: (sql) => sql.includes("scan_request"), rows: [{ route: "preflight", requests: "7", errors: "1", p95_duration_ms: "1050", p95_vision_ms: "900", p95_catalog_ms: "60" }] },
  { match: (sql) => sql.includes("scanner_completed"), rows: [{ completions: "6", p95_capture_ready_ms: "250", p95_first_preflight_dispatch_ms: "330", p95_preflight_rtt_ms: "1100", p95_analyze_rtt_ms: "1600", p95_render_ms: "90" }] },
  { match: (sql) => sql.includes("catalog_resolution") && sql.includes("outcomes"), rows: [{ confirmed: "3", estimate: "2", unknown: "1", total: "6" }] },
  { match: (sql) => sql.includes("catalog_resolution") && sql.includes("defaultConfidenceCount"), rows: [{ default_confidence_count: "2", total: "6" }] },
  { match: (sql) => sql.includes("detection_unbranded_name"), rows: [{ count: "4" }] },
  { match: (sql) => sql.includes("breaker_transition"), rows: [{ operation: "preflight", opened: "2", closed: "1" }] },
];

test("dashboard overview fills missing metrics and returns aggregate-only event data", async () => {
  const db = {
    async query(sql: string) {
      const rule = RULES.find((candidate) => candidate.match(sql));
      if (!rule) throw new Error(`dashboard.test.ts: no mock rule matched query: ${sql.slice(0, 120)}...`);
      return { rows: rule.rows };
    },
  };
  const overview = await readDashboardOverview(db as unknown as SqlQueryExecutor, new Date("2026-08-31T12:00:00.000Z"));
  assert.equal(overview.metrics.find((metric) => metric.key === "scan_started")?.value, 12);
  assert.equal(overview.metrics.find((metric) => metric.key === "vision_errors")?.value, 0);
  assert.equal(overview.metrics.find((metric) => metric.key === "gemini_estimated_cost_usd")?.value, null);
  assert.deepEqual(overview.funnel[0], { label: "Scan → result", numerator: 0, denominator: 12, rate: 0, previousRate: 0 });
  assert.deepEqual(overview.stripe, [{ currency: "EUR", paidCheckoutSessions: 2, refundedPayments: 1, grossMinor: 998, refundedMinor: 499, netMinor: 499 }]);
  assert.deepEqual(overview.operations, { visionRequests: 10, visionErrors: 2, visionErrorRate: 0.2, visionP95Ms: 850 });
  assert.deepEqual(overview.quality, [{ label: "mixed", value: 7 }]);
  assert.deepEqual(overview.users, { day: 4, week: 12, month: 28 });
  assert.deepEqual(overview.recentEvents, [{ occurredAt: "2026-08-31T10:15:00.000Z", eventName: "vision_usage", source: "server" }]);
  assert.equal(overview.geminiHealth.days.at(-1)?.requests, 8);
  assert.deepEqual(overview.geminiHealth.dailyOperations, [{ day: "2026-08-31", operation: "preflight", requests: 8, successes: 6, timeoutErrors: 1, p50LatencyMs: 400, p95LatencyMs: 900, p95QueueMs: 40 }]);
  assert.deepEqual(overview.geminiHealth.dailyExperience, [{ day: "2026-08-31", completions: 6, p95FirstPreflightDispatchMs: 330, p95PreflightRttMs: 1100, p95AnalyzeRttMs: 1600 }]);
  assert.deepEqual(overview.geminiHealth.dailyRoutes, [{ day: "2026-08-31", route: "preflight", requests: 7, errors: 1, p95DurationMs: 1050, p95VisionMs: 900, p95CatalogMs: 60 }]);
  assert.deepEqual(overview.geminiHealth.dailyScoreYield, [{ day: "2026-08-31", confirmed: 3, estimate: 2, unknown: 1, total: 6 }]);
  assert.deepEqual(overview.geminiHealth.dailyConfidenceStats, [{ day: "2026-08-31", defaultConfidenceCount: 2, total: 6 }]);
  assert.deepEqual(overview.guardRejections, [{ scope: "analyze", guard: "request_rate_limit", dimension: "installation", current: 3, previous: 1 }]);

  for (const window of ["24h", "7d"] as const) {
    const headline = overview.geminiHealth.headline[window];
    assert.deepEqual(headline.models, [{ model: "gemini-3.6-flash", operation: "preflight", requests: 8, errors: 2, timeoutErrors: 1, successRate: 0.75, p50LatencyMs: 400, p95LatencyMs: 900, totalTokens: 1200, estimatedCostUsd: 0.02 }]);
    assert.deepEqual(headline.operations, [{ operation: "preflight", requests: 8, errors: 2, timeoutErrors: 1, p50LatencyMs: 400, p95LatencyMs: 900, p95QueueMs: 40 }]);
    assert.deepEqual(headline.routes, [{ route: "preflight", requests: 7, errors: 1, p95DurationMs: 1050, p95VisionMs: 900, p95CatalogMs: 60 }]);
    assert.deepEqual(headline.experience, { completions: 6, p95CaptureReadyMs: 250, p95FirstPreflightDispatchMs: 330, p95PreflightRttMs: 1100, p95AnalyzeRttMs: 1600, p95RenderMs: 90 });
    assert.deepEqual(headline.scoreYield, { confirmed: 3, estimate: 2, unknown: 1, total: 6 });
    assert.deepEqual(headline.hedgeStats, [{ operation: "analyze", eligible: 5, won: 2 }]);
    assert.deepEqual(headline.confidenceStats, { defaultConfidenceCount: 2, total: 6 });
    assert.equal(headline.unbrandedDetectionCount, 4);
    assert.deepEqual(headline.breakerTransitions, [{ operation: "preflight", opened: 2, closed: 1 }]);
  }
});
