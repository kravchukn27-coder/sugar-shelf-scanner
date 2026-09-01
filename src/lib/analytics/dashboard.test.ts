import assert from "node:assert/strict";
import test from "node:test";
import { readDashboardOverview } from "./dashboard";
import type { SqlQueryExecutor } from "@/lib/catalog/repository";

test("dashboard overview fills missing metrics and returns aggregate-only event data", async () => {
  let calls = 0;
  const db = {
    async query() {
      calls += 1;
      if (calls === 1) return { rows: [{ key: "scan_started", current_value: "12", previous_value: "8" }] };
      if (calls === 2) return { rows: [{ label: "mixed", value: "7" }] };
      if (calls === 3) return { rows: [{ currency: "eur", paid_checkout_sessions: "2", refunded_payments: "1", gross_minor: "998", refunded_minor: "499" }] };
      if (calls === 4) return { rows: [{ vision_requests: "10", vision_errors: "2", vision_p95_ms: "850" }] };
      if (calls === 5) return { rows: [{ occurred_at: "2026-08-31T10:15:00.000Z", event_name: "vision_usage", source: "server" }] };
      if (calls === 6) return { rows: [{ day: "4", week: "12", month: "28" }] };
      if (calls === 7) return { rows: [{ day: "2026-08-31T00:00:00Z", requests: "8", errors: "2", timeout_errors: "1", p95_latency_ms: "900", p95_queue_ms: "40" }] };
      if (calls === 8) return { rows: [{ day: "2026-08-31T00:00:00Z", total_tokens: "1200", estimated_cost_usd: "0.02" }] };
      if (calls === 9) return { rows: [{ model: "gemini-3.6-flash", requests: "8", errors: "2", timeout_errors: "1", p95_latency_ms: "900" }] };
      if (calls === 10) return { rows: [{ model: "gemini-3.6-flash", total_tokens: "1200", estimated_cost_usd: "0.02" }] };
      if (calls === 11) return { rows: [{ operation: "preflight", requests: "8", errors: "2", timeout_errors: "1", p50_latency_ms: "400", p95_latency_ms: "900", p95_queue_ms: "40" }] };
      if (calls === 12) return { rows: [{ day: "2026-08-31T00:00:00Z", operation: "preflight", requests: "8", successes: "6", timeout_errors: "1", p50_latency_ms: "400", p95_latency_ms: "900", p95_queue_ms: "40" }] };
      if (calls === 13) return { rows: [{ route: "preflight", requests: "7", errors: "1", p95_duration_ms: "1050", p95_vision_ms: "900", p95_catalog_ms: "60" }] };
      if (calls === 14) return { rows: [{ completions: "6", p95_capture_ready_ms: "250", p95_first_preflight_dispatch_ms: "330", p95_preflight_rtt_ms: "1100", p95_analyze_rtt_ms: "1600", p95_render_ms: "90" }] };
      if (calls === 15) return { rows: [{ day: "2026-08-31T00:00:00Z", completions: "6", p95_first_preflight_dispatch_ms: "330", p95_preflight_rtt_ms: "1100", p95_analyze_rtt_ms: "1600" }] };
      return { rows: [{ scope: "analyze", guard: "request_rate_limit", dimension: "installation", current_value: "3", previous_value: "1" }] };
    },
  };
  const overview = await readDashboardOverview(db as unknown as SqlQueryExecutor, new Date("2026-08-31T12:00:00.000Z"));
  assert.equal(calls, 16);
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
  assert.deepEqual(overview.geminiHealth.models, [{ model: "gemini-3.6-flash", requests: 8, errors: 2, timeoutErrors: 1, p95LatencyMs: 900, totalTokens: 1200, estimatedCostUsd: 0.02 }]);
  assert.deepEqual(overview.geminiHealth.operations, [{ operation: "preflight", requests: 8, errors: 2, timeoutErrors: 1, p50LatencyMs: 400, p95LatencyMs: 900, p95QueueMs: 40 }]);
  assert.deepEqual(overview.geminiHealth.dailyOperations, [{ day: "2026-08-31", operation: "preflight", requests: 8, successes: 6, timeoutErrors: 1, p50LatencyMs: 400, p95LatencyMs: 900, p95QueueMs: 40 }]);
  assert.deepEqual(overview.geminiHealth.historicalComparisons[0], { period: "Aug 26–27 · healthy baseline", requests: 291, successRate: 0.811, preflightP50Ms: "2.7 s", preflightTimeoutRate: 0.124, note: "Archived Railway summary" });
  assert.deepEqual(overview.geminiHealth.routes, [{ route: "preflight", requests: 7, errors: 1, p95DurationMs: 1050, p95VisionMs: 900, p95CatalogMs: 60 }]);
  assert.deepEqual(overview.geminiHealth.experience, { completions: 6, p95CaptureReadyMs: 250, p95FirstPreflightDispatchMs: 330, p95PreflightRttMs: 1100, p95AnalyzeRttMs: 1600, p95RenderMs: 90 });
  assert.deepEqual(overview.geminiHealth.dailyExperience, [{ day: "2026-08-31", completions: 6, p95FirstPreflightDispatchMs: 330, p95PreflightRttMs: 1100, p95AnalyzeRttMs: 1600 }]);
  assert.deepEqual(overview.guardRejections, [{ scope: "analyze", guard: "request_rate_limit", dimension: "installation", current: 3, previous: 1 }]);
});
