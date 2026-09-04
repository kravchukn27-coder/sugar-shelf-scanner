"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./analytics-dashboard.module.css";
import type { DashboardOverview } from "@/lib/analytics/dashboard";
import type { CloudBillingSummary } from "@/lib/analytics/cloud-billing";

// Circuit-breaker status, joined in from Redis by the overview route
// alongside the Postgres-backed dashboard data (see
// src/lib/observability/circuit-breaker.ts for the source of truth). It's
// optional here because a cached/older response, or a Redis hiccup on the
// server, may omit it -- the UI must treat that as "no data", never crash.
type BreakerOperationStatus = { state: "closed" | "open" | "probing"; sinceMs: number | null; currentModel: string | null };
type OverviewResponse = DashboardOverview & { breaker?: Record<string, BreakerOperationStatus> };

const REFRESH_MS = 30_000;
type OverviewRange = "24h" | "3d" | "7d" | "all";
// "24h" is fixed to the calendar day (UTC midnight to now), not a rolling
// 24-hour lookback -- see startOfUtcDay's doc comment in dashboard.ts.
const RANGE_LABELS: Record<OverviewRange, string> = { "24h": "Today", "3d": "Last 3 days", "7d": "Last 7 days", all: "All time" };
// The top metrics row mixed product/business counters with Gemini
// reliability counters in one undifferentiated grid — split by this set so a
// quick scan doesn't have to parse "is this a business or a technical
// number" per card.
const GEMINI_METRIC_KEYS = new Set(["vision_requests", "vision_errors", "gemini_total_tokens", "gemini_estimated_cost_usd"]);
// Below this many attempts a conversion rate is noise, not a rate — e.g. 1
// of 1 rendering as a confident "100%" next to a real 76% (19 of 25).
const MIN_RATE_SAMPLE = 10;
// "no_detection" (Gemini found nothing) is the one outcome in the quality
// mix that means the scan just failed the user — worth a callout once it's
// a meaningful share, not just another row in the list.
const NO_DETECTION_ALERT_THRESHOLD = 0.2;

function formatValue(value: number | null, unit: "count" | "usd") {
  if (value === null) return "Unpriced";
  if (unit === "usd") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

// "24h" compares against yesterday (the prior calendar day, now that "24h"
// is fixed to today-so-far rather than a rolling lookback); 3d/7d stay
// rolling windows, so "prior 3d"/"prior 7d" is still the accurate label.
function formatDelta(current: number | null, previous: number | null, range: OverviewRange) {
  if (current === null || previous === null) return "No priced usage";
  if (previous === 0) return current === 0 ? "No change" : "New";
  const percentage = ((current - previous) / previous) * 100;
  const comparisonLabel = range === "24h" ? "vs yesterday" : `vs prior ${range}`;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(0)}% ${comparisonLabel}`;
}

function deltaTone(current: number | null, previous: number | null, metricKey: string) {
  if (current === null || previous === null) return styles.neutral;
  if (current === previous) return styles.neutral;
  const lowerIsBetter = metricKey === "vision_errors" || metricKey === "gemini_estimated_cost_usd";
  const improving = lowerIsBetter ? current < previous : current > previous;
  return improving ? styles.positive : styles.negative;
}

function formatEventName(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatGuardName(value: string) {
  const labels: Record<string, string> = {
    request_rate_limit: "Endpoint rate limit",
    redis_unavailable: "Redis unavailable",
    gemini_global_concurrency: "Gemini global concurrency",
    gemini_operation_concurrency: "Gemini operation concurrency",
    gemini_minute_budget: "Gemini minute budget",
    gemini_day_budget: "Gemini daily budget",
  };
  return labels[value] ?? formatEventName(value);
}

function formatPercent(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function formatMinor(value: number, currency: string) {
  if (currency === "UNKNOWN") return `${value} minor units`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100);
}

function formatBilling(value: number | null, currency: string | null) {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
}

// A per-request Gemini cost is routinely a fraction of a cent -- the
// standard 2-decimal formatBilling above would round every real value to
// "$0.00" and say nothing. Switches to enough decimals to show a nonzero
// digit, capped so a genuinely zero cost still reads as a clean "$0.00".
function formatMicroBilling(value: number | null, currency: string | null) {
  if (value === null) return "—";
  if (value === 0) return formatBilling(0, currency);
  const decimals = value < 0.01 ? 4 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

// Sub-second values (queue time, render time) stay in milliseconds, where
// "94 ms" is a precise, meaningful number — rounding that to "0.1 s" loses
// exactly the "this is basically nothing" read it's meant to give. Anything
// a full second or slower switches to seconds.
function formatMs(value: number | null) {
  if (value === null) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

// The "Last 7 days" heading is a request window, not a coverage guarantee —
// Railway log buffers reset on every redeploy, so it commonly holds far less
// than 7 days of real data. Say so explicitly instead of implying a week of
// history that isn't there.
function coverageLabel(daysWithData: number) {
  if (daysWithData >= 7) return "Last 7 days";
  if (daysWithData <= 1) return "Last 7 days · data from 1 day";
  return `Last 7 days · data from ${daysWithData} days`;
}

// The circuit breaker's "since" timestamp is meaningful across on-call
// handoffs regardless of the viewer's local timezone, so it's rendered in
// UTC explicitly rather than the browser's local time.
function formatBreakerSince(sinceMs: number | null) {
  if (sinceMs === null) return null;
  return `${new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(sinceMs))} UTC`;
}

function formatOperationLabel(operation: string) {
  return operation === "preflight" ? "Preflight" : operation === "analyze" ? "Analyze" : formatEventName(operation);
}

// Percentage-point delta against the archived healthy-baseline window, shown
// inline on today's numbers so "is this normal?" doesn't require flipping
// back and forth to the historical comparison table above.
function formatDeltaPoints(current: number | null, baseline: number | null) {
  if (current === null || baseline === null) return null;
  const points = (current - baseline) * 100;
  if (Math.abs(points) < 1) return "≈ baseline";
  return `${points > 0 ? "+" : ""}${points.toFixed(0)}pp vs baseline`;
}

function deltaPointsTone(current: number | null, baseline: number | null, lowerIsBetter = false) {
  if (current === null || baseline === null) return styles.neutral;
  const points = current - baseline;
  if (Math.abs(points) < 0.01) return styles.neutral;
  const improving = lowerIsBetter ? points < 0 : points > 0;
  return improving ? styles.positive : styles.negative;
}

// For latency (ms), a percentage-point difference is meaningless — "+2200pp"
// vs a 5s baseline says nothing. Relative % change reads naturally instead:
// "+90% vs avg" for a day that took nearly double the typical time.
function formatRelativeDelta(current: number | null, baseline: number | null) {
  if (current === null || baseline === null || baseline === 0) return null;
  const percentage = ((current - baseline) / baseline) * 100;
  if (Math.abs(percentage) < 3) return "≈ avg";
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(0)}% vs avg`;
}

function relativeDeltaTone(current: number | null, baseline: number | null, lowerIsBetter = true) {
  if (current === null || baseline === null || baseline === 0) return styles.neutral;
  const percentage = (current - baseline) / baseline;
  if (Math.abs(percentage) < 0.03) return styles.neutral;
  const improving = lowerIsBetter ? percentage < 0 : percentage > 0;
  return improving ? styles.positive : styles.negative;
}

/**
 * Per-operation baseline = the average over every day EXCEPT the most
 * recent one, so "today" is compared against "typical, before today" —
 * not against an average that already has today baked into it. That
 * self-inclusion was the bug in the first version of this: with only one
 * day of data on record (this app's log buffer resets on every redeploy),
 * "today vs average" was silently "today vs itself", always reading
 * ≈avg. Once a real prior day exists it becomes part of the baseline;
 * until then this correctly returns no baseline (null) rather than a
 * meaningless one. Rate metrics (success, timeout) are pooled (sum of
 * counts, not mean of daily %s) so a high-volume day is not diluted by a
 * low-volume one; latency figures are a simple mean of the daily
 * p50/p95/queue values, the standard, if approximate, way to summarize
 * percentiles across days.
 */
// The persisted analytics DB (this dashboard's own data source) only started
// recording vision_request rows the day this feature shipped (2026-09-01) —
// there is no real "yesterday" to average yet, not because of a bug, but
// because the table is brand new. Rather than show no comparison at all
// until a real prior day accumulates, fall back to the figures already
// hand-verified from raw Railway logs during the healthy 2026-08-26/27
// window (see docs/scan-performance-changelog.md). analyze's success/timeout split
// wasn't cleanly isolated in that investigation (only the overall
// scan_request rate was, and "timeouts concentrated in preflight" was noted
// qualitatively) — p50 is the one number solid enough to carry over as-is,
// so analyze's fallback deliberately leaves the rate fields null rather than
// guess at a number this file cannot back up.
const ARCHIVED_OPERATION_BASELINE: Record<string, { successRate: number | null; timeoutRate: number | null; p50LatencyMs: number | null }> = {
  preflight: { successRate: 0.811, timeoutRate: 0.124, p50LatencyMs: 2700 },
  analyze: { successRate: null, timeoutRate: null, p50LatencyMs: 3300 },
};

/** Per-group (e.g. per-operation, per-route) map of that group's most recent day. */
function latestDayPerGroup<T extends { day: string }>(rows: T[], groupKey: (row: T) => string): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows) {
    const key = groupKey(row);
    const current = latest.get(key);
    if (!current || row.day > current) latest.set(key, row.day);
  }
  return latest;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function useOperationAverages(dailyOperations: { day: string; operation: string; requests: number; successes: number; timeoutErrors: number; p50LatencyMs: number | null; p95LatencyMs: number | null; p95QueueMs: number | null }[] | undefined) {
  return useMemo(() => {
    const rows = dailyOperations ?? [];
    const latestDayByOperation = latestDayPerGroup(rows, (row) => row.operation);
    const byOperation = new Map<string, { requests: number; successes: number; timeoutErrors: number; p50s: number[]; p95s: number[]; queues: number[] }>();
    for (const day of rows) {
      if (day.day === latestDayByOperation.get(day.operation)) continue; // exclude "today" from its own baseline
      const bucket = byOperation.get(day.operation) ?? { requests: 0, successes: 0, timeoutErrors: 0, p50s: [], p95s: [], queues: [] };
      bucket.requests += day.requests;
      bucket.successes += day.successes;
      bucket.timeoutErrors += day.timeoutErrors;
      if (day.p50LatencyMs !== null) bucket.p50s.push(day.p50LatencyMs);
      if (day.p95LatencyMs !== null) bucket.p95s.push(day.p95LatencyMs);
      if (day.p95QueueMs !== null) bucket.queues.push(day.p95QueueMs);
      byOperation.set(day.operation, bucket);
    }
    const averages = new Map<string, { successRate: number | null; timeoutRate: number | null; p50LatencyMs: number | null; p95LatencyMs: number | null; p95QueueMs: number | null }>();
    const operations = new Set([...byOperation.keys(), ...latestDayByOperation.keys()]);
    for (const operation of operations) {
      const bucket = byOperation.get(operation);
      const archived = ARCHIVED_OPERATION_BASELINE[operation];
      averages.set(operation, {
        successRate: bucket?.requests ? bucket.successes / bucket.requests : archived?.successRate ?? null,
        timeoutRate: bucket?.requests ? bucket.timeoutErrors / bucket.requests : archived?.timeoutRate ?? null,
        p50LatencyMs: mean(bucket?.p50s ?? []) ?? archived?.p50LatencyMs ?? null,
        p95LatencyMs: mean(bucket?.p95s ?? []),
        p95QueueMs: mean(bucket?.queues ?? []),
      });
    }
    return averages;
  }, [dailyOperations]);
}

type ExperienceComparison = { p95FirstPreflightDispatchMs: number | null; p95PreflightRttMs: number | null; p95AnalyzeRttMs: number | null };
type ExperienceComparisonPair = { yesterday: ExperienceComparison | null; average: ExperienceComparison | null };

/**
 * "Yesterday" is the calendar day (UTC) before `referenceIso`, looked up
 * directly by date -- not just "the second row in the array" -- so it
 * reads correctly even on a day with zero scans so far. "Average" reuses
 * the same leave-the-latest-day-out logic as useOperationAverages above
 * (excludes whichever day is most recent *in the data*, which may lag
 * behind `referenceIso` if today has no rows yet).
 */
function useExperienceComparison(
  dailyExperience: { day: string; completions: number; p95FirstPreflightDispatchMs: number | null; p95PreflightRttMs: number | null; p95AnalyzeRttMs: number | null }[] | undefined,
  referenceIso: string | undefined,
): ExperienceComparisonPair {
  return useMemo(() => {
    const rows = dailyExperience ?? [];
    if (rows.length === 0 || !referenceIso) return { yesterday: null, average: null };
    const yesterdayKey = new Date(new Date(referenceIso).getTime() - 86_400_000).toISOString().slice(0, 10);
    const yesterdayRow = rows.find((row) => row.day === yesterdayKey) ?? null;
    const latestDay = rows.reduce((max, row) => (row.day > max ? row.day : max), rows[0]!.day);
    const prior = rows.filter((row) => row.day !== latestDay);
    const field = (source: typeof rows, key: keyof ExperienceComparison) => mean(source.map((row) => row[key]).filter((value): value is number => value !== null));
    return {
      yesterday: yesterdayRow ? { p95FirstPreflightDispatchMs: yesterdayRow.p95FirstPreflightDispatchMs, p95PreflightRttMs: yesterdayRow.p95PreflightRttMs, p95AnalyzeRttMs: yesterdayRow.p95AnalyzeRttMs } : null,
      average: prior.length ? { p95FirstPreflightDispatchMs: field(prior, "p95FirstPreflightDispatchMs"), p95PreflightRttMs: field(prior, "p95PreflightRttMs"), p95AnalyzeRttMs: field(prior, "p95AnalyzeRttMs") } : null,
    };
  }, [dailyExperience, referenceIso]);
}

type RouteComparison = { p95DurationMs: number | null; p95VisionMs: number | null; p95CatalogMs: number | null };

/** Same yesterday/average shape as useExperienceComparison, keyed per route since routes have independent timings. */
function useRouteComparisons(
  dailyRoutes: { day: string; route: string; requests: number; errors: number; p95DurationMs: number | null; p95VisionMs: number | null; p95CatalogMs: number | null }[] | undefined,
  referenceIso: string | undefined,
): Map<string, { yesterday: RouteComparison | null; average: RouteComparison | null }> {
  return useMemo(() => {
    const rows = dailyRoutes ?? [];
    const result = new Map<string, { yesterday: RouteComparison | null; average: RouteComparison | null }>();
    if (rows.length === 0 || !referenceIso) return result;
    const yesterdayKey = new Date(new Date(referenceIso).getTime() - 86_400_000).toISOString().slice(0, 10);
    const latestDayByRoute = latestDayPerGroup(rows, (row) => row.route);
    const byRoute = new Map<string, typeof rows>();
    for (const row of rows) byRoute.set(row.route, [...(byRoute.get(row.route) ?? []), row]);
    for (const [route, routeRows] of byRoute) {
      const yesterdayRow = routeRows.find((row) => row.day === yesterdayKey) ?? null;
      const prior = routeRows.filter((row) => row.day !== latestDayByRoute.get(route));
      const field = (source: typeof routeRows, key: keyof RouteComparison) => mean(source.map((row) => row[key]).filter((value): value is number => value !== null));
      result.set(route, {
        yesterday: yesterdayRow ? { p95DurationMs: yesterdayRow.p95DurationMs, p95VisionMs: yesterdayRow.p95VisionMs, p95CatalogMs: yesterdayRow.p95CatalogMs } : null,
        average: prior.length ? { p95DurationMs: field(prior, "p95DurationMs"), p95VisionMs: field(prior, "p95VisionMs"), p95CatalogMs: field(prior, "p95CatalogMs") } : null,
      });
    }
    return result;
  }, [dailyRoutes, referenceIso]);
}

/**
 * Score yield = (confirmed + estimate) / total detections -- of everything
 * Gemini detected, how much actually resolved to a usable score. Pools
 * counts (not a mean of daily rates) for the average, same convention as
 * successRate/timeoutRate in useOperationAverages above, so a high-volume
 * day isn't diluted by a quiet one.
 */
function useScoreYieldComparison(
  dailyScoreYield: { day: string; confirmed: number; estimate: number; unknown: number; total: number }[] | undefined,
  referenceIso: string | undefined,
): { yesterday: number | null; average: number | null } {
  return useMemo(() => {
    const rows = dailyScoreYield ?? [];
    if (rows.length === 0 || !referenceIso) return { yesterday: null, average: null };
    const yieldRate = (row: { confirmed: number; estimate: number; total: number }) => (row.total ? (row.confirmed + row.estimate) / row.total : null);
    const yesterdayKey = new Date(new Date(referenceIso).getTime() - 86_400_000).toISOString().slice(0, 10);
    const yesterdayRow = rows.find((row) => row.day === yesterdayKey) ?? null;
    const latestDay = rows.reduce((max, row) => (row.day > max ? row.day : max), rows[0]!.day);
    const prior = rows.filter((row) => row.day !== latestDay);
    const pooled = prior.reduce((total, row) => ({ confirmed: total.confirmed + row.confirmed, estimate: total.estimate + row.estimate, total: total.total + row.total }), { confirmed: 0, estimate: 0, total: 0 });
    return {
      yesterday: yesterdayRow ? yieldRate(yesterdayRow) : null,
      average: pooled.total ? (pooled.confirmed + pooled.estimate) / pooled.total : null,
    };
  }, [dailyScoreYield, referenceIso]);
}

/** Compact "vs yesterday" / "vs 7d avg" badge pair, reusing the existing relative-delta formatting. */
function ComparisonBadges({ current, yesterday, average, lowerIsBetter = true }: { current: number | null; yesterday: number | null | undefined; average: number | null | undefined; lowerIsBetter?: boolean }) {
  const hasYesterday = yesterday !== null && yesterday !== undefined;
  const hasAverage = average !== null && average !== undefined;
  if (!hasYesterday && !hasAverage) return null;
  return <span className={styles.deltaBadges}>
    {hasYesterday && <small className={relativeDeltaTone(current, yesterday, lowerIsBetter)}>{formatRelativeDelta(current, yesterday) ?? "—"} yesterday</small>}
    {hasAverage && <small className={relativeDeltaTone(current, average, lowerIsBetter)}>{formatRelativeDelta(current, average) ?? "—"} 7d avg</small>}
  </span>;
}

// Every headline panel defaults to following the global Gemini Health
// toggle, but can be pried loose to look at its own window independently
// (e.g. spot-checking one table on 24h while the rest stay on 7d). An
// override is cleared the moment the global toggle itself is clicked again
// -- that's the "reset to global" behavior -- not on every render, which is
// why this lives in its own state rather than being derived.
type GeminiRange = "24h" | "7d";
type PanelKey = "metrics" | "breakerRow" | "performance" | "models";

/** Small per-panel 24h/7d toggle, visually subordinate to the global one via `.panelRangeTabs`. */
function PanelRangeToggle({ value, onChange }: { value: GeminiRange; onChange: (value: GeminiRange) => void }) {
  return <div className={styles.panelRangeTabs} aria-label="Panel date range">
    <button className={value === "24h" ? styles.rangeActive : undefined} onClick={() => onChange("24h")}>24h</button>
    <button className={value === "7d" ? styles.rangeActive : undefined} onClick={() => onChange("7d")}>7d</button>
  </div>;
}

function daysInMonthUtc(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/** 1-indexed: the 1st of the month counts as day 1 already elapsed, so a same-day projection doesn't divide by zero. */
function daysElapsedInMonthUtc(date: Date): number {
  return date.getUTCDate();
}

// Rounds a value up to a "nice" 1/2/5 * 10^n step, so the Y axis max reads
// as a clean number ($0.50, $2, $5 ...) instead of an arbitrary max cost.
function niceAxisMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

// Path for a bar with rounded top corners only (flat bottom, sitting flush on the axis).
function topRoundedBarPath(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  const radius = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
}

/** Inline SVG spend chart -- no charting library, matching the rest of this dashboard's hand-rolled visuals (see .qualityList's bars). */
function DailySpendChart({ days, currency }: { days: { day: string; costUsd: number; totalTokens: number | null }[]; currency: string | null }) {
  if (days.length === 0) return <p className={styles.empty}>No daily Gemini cost rows in this window yet.</p>;

  const width = 700;
  const height = 150;
  const marginLeft = 46;
  const marginRight = 6;
  const marginTop = 10;
  const marginBottom = 22;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;

  const rawMax = Math.max(...days.map((entry) => entry.costUsd), 0);
  const axisMax = niceAxisMax(Math.max(rawMax, 0.01));
  const yFor = (value: number) => marginTop + chartHeight - (value / axisMax) * chartHeight;
  const gridValues = [0, axisMax / 2, axisMax];

  // 7-day view labels every bar; wider windows space labels out so they don't overlap.
  const labelStep = days.length <= 7 ? 1 : Math.ceil(days.length / 7);

  const slotWidth = chartWidth / days.length;
  const barWidth = Math.max(2, Math.min(slotWidth * 0.55, 40));

  return <div className={styles.dailySpendChart}>
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="150" role="img" aria-label="Daily Gemini spend">
      {gridValues.map((value, i) => {
        const y = yFor(value);
        return <g key={i}>
          <line className={styles.dailySpendGridLine} x1={marginLeft} x2={width - marginRight} y1={y} y2={y} />
          <text className={styles.dailySpendAxisLabel} x={marginLeft - 6} y={y} textAnchor="end" dominantBaseline={i === 0 ? "text-after-edge" : "middle"}>{formatMicroBilling(value, currency)}</text>
        </g>;
      })}
      {days.map((entry, i) => {
        const label = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${entry.day}T00:00:00Z`));
        const x = marginLeft + i * slotWidth + (slotWidth - barWidth) / 2;
        const barHeight = (entry.costUsd / axisMax) * chartHeight;
        const y = yFor(entry.costUsd);
        const showLabel = i % labelStep === 0 || i === days.length - 1;
        return <g key={entry.day}>
          <path className={styles.dailySpendBar} d={topRoundedBarPath(x, y, barWidth, Math.max(barHeight, entry.costUsd > 0 ? 2 : 0), 2)}>
            <title>{`${label}: ${formatMicroBilling(entry.costUsd, currency)}${entry.totalTokens === null ? "" : ` · ${new Intl.NumberFormat("en-US").format(entry.totalTokens)} tokens`}`}</title>
          </path>
          {showLabel && <text className={styles.dailySpendAxisLabel} x={x + barWidth / 2} y={height - 4} textAnchor="middle">{label}</text>}
        </g>;
      })}
    </svg>
  </div>;
}

/**
 * Redesigned 2026-09-04 to answer "is this normal, and are we close to our
 * limit" the way the AI Studio Gemini Spend page does -- but built only from
 * what Google actually exposes programmatically. The AI Studio spend-cap
 * progress bar and prepay balance have no public API (confirmed against
 * ai.google.dev/gemini-api/docs/billing); "Your configured monthly cap"
 * below is read from GEMINI_MONTHLY_SPEND_CAP_USD, an env var the operator
 * sets to match whatever they configured in AI Studio, not fetched live.
 */
function CloudBillingPanel({ billing, generatedAt, sevenDayRequestTotal, dailyTokens }: { billing: CloudBillingSummary; generatedAt: string; sevenDayRequestTotal: number; dailyTokens: { day: string; totalTokens: number }[] }) {
  const [chartRange, setChartRange] = useState<"7d" | "28d">("28d");
  const emptyReason = billing.state === "waiting_for_export" ? "Google has not published a billing table yet. It can take several hours after enabling export."
    : billing.state === "no_data" ? "The billing table exists, but it has no reported cost rows for this project yet."
    : billing.state === "not_configured" ? "Connect the read-only BigQuery service account to show billed spend."
    : "BigQuery could not be reached; the dashboard will retry automatically.";
  if (billing.state !== "available" && billing.state !== "stale") {
    return <article className={styles.widePanel}>
      <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Cloud Billing</p><h2>Real spend and budget</h2></div><span>{billing.state.replaceAll("_", " ")}</span></div>
      <p className={styles.empty}>{emptyReason}</p>
    </article>;
  }

  const now = new Date(generatedAt);
  const dailyByDay = new Map(billing.dailyGeminiCostUsd.map((entry) => [entry.day, entry.costUsd]));
  const yesterdayKey = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const dayBeforeKey = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const yesterday = dailyByDay.get(yesterdayKey) ?? null;
  const dayBefore = dailyByDay.get(dayBeforeKey) ?? null;
  const avgPerRequest = sevenDayRequestTotal > 0 && billing.geminiLast7Days !== null ? billing.geminiLast7Days / sevenDayRequestTotal : null;
  const daysElapsed = daysElapsedInMonthUtc(now);
  const daysInMonth = daysInMonthUtc(now);
  const projectedMonthEnd = billing.geminiMonthToDate !== null && daysElapsed > 0 ? (billing.geminiMonthToDate / daysElapsed) * daysInMonth : null;
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long" }).format(now);
  const capPercent = billing.monthlySpendCapUsd && billing.geminiMonthToDate !== null ? Math.min(100, (billing.geminiMonthToDate / billing.monthlySpendCapUsd) * 100) : null;
  const tokensByDay = new Map(dailyTokens.map((entry) => [entry.day, entry.totalTokens]));
  const chartDays = billing.dailyGeminiCostUsd.slice(chartRange === "7d" ? -7 : -28).map((entry) => ({ ...entry, totalTokens: tokensByDay.get(entry.day) ?? null }));

  return <article className={styles.widePanel}>
    <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Cloud Billing</p><h2>Real spend and budget</h2></div><span>Reconciled with a delay</span></div>
    {billing.state === "stale" && <p className={styles.qualityAlert}>Warning: this export is more than 36 hours old.</p>}
    <div className={styles.billingMetrics}>
      <article className={styles.metricCard}><p>Month to date</p><strong>{formatBilling(billing.geminiMonthToDate, billing.currency)}</strong><span className={styles.neutral}>Since {monthLabel} 1</span></article>
      <article className={styles.metricCard}><p>Yesterday</p><strong>{formatBilling(yesterday, billing.currency)}</strong><span className={yesterday === null || dayBefore === null ? styles.neutral : relativeDeltaTone(yesterday, dayBefore)}>{yesterday === null ? "No cost rows yet" : dayBefore === null ? "No prior day yet" : `${formatRelativeDelta(yesterday, dayBefore) ?? "—"} vs day before`}</span></article>
      <article className={styles.metricCard}><p>Avg per request · last 7 days</p><strong>{formatMicroBilling(avgPerRequest, billing.currency)}</strong><span className={styles.neutral}>{avgPerRequest === null ? "No requests in this window" : `${formatBilling(avgPerRequest * 100, billing.currency)} per 100 calls`}</span></article>
      <article className={styles.metricCard}><p>Projected month end</p><strong>{formatBilling(projectedMonthEnd, billing.currency)}</strong><span className={styles.neutral}>At current daily pace</span></article>
    </div>
    {billing.monthlySpendCapUsd !== null && <div className={styles.billingCap}>
      <div><span>Your configured monthly cap</span><span><strong>{formatBilling(billing.geminiMonthToDate, billing.currency)}</strong> / {formatBilling(billing.monthlySpendCapUsd, billing.currency)}</span></div>
      <i><b style={{ width: `${capPercent ?? 0}%` }} /></i>
      <p className={styles.panelNote}>Cap is set manually (GEMINI_MONTHLY_SPEND_CAP_USD) — Google has no public API for the AI Studio spend cap or prepay balance.</p>
    </div>}
    <div className={styles.panelToggleRow}><span className={styles.panelToggleLabel}>Daily Gemini spend</span><div className={styles.panelRangeTabs} aria-label="Chart date range"><button className={chartRange === "7d" ? styles.rangeActive : undefined} onClick={() => setChartRange("7d")}>7d</button><button className={chartRange === "28d" ? styles.rangeActive : undefined} onClick={() => setChartRange("28d")}>28d</button></div></div>
    <DailySpendChart days={chartDays} currency={billing.currency} />
    <p className={styles.panelNote}>Actual billed amounts include credits; the Gemini subset is matched from billing service/SKU names. Latest reported usage: {billing.latestUsageAt ? new Date(billing.latestUsageAt).toLocaleString() : "—"}.</p>
  </article>;
}

export default function AnalyticsDashboard() {
  const [secret, setSecret] = useState("");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "unauthorized" | "unavailable">("idle");
  const [view, setView] = useState<"overview" | "gemini">("overview");
  const [range, setRange] = useState<OverviewRange>("24h");
  // Independent from the Product-pulse range above: Gemini Health has its
  // own single 24h/7d toggle covering every headline panel on that tab.
  const [geminiRange, setGeminiRange] = useState<GeminiRange>("7d");
  const [panelOverrides, setPanelOverrides] = useState<Partial<Record<PanelKey, GeminiRange>>>({});
  const effectiveRange = useCallback((panel: PanelKey): GeminiRange => panelOverrides[panel] ?? geminiRange, [panelOverrides, geminiRange]);
  // Changing the global toggle is what "resets every panel back to
  // following it" means -- so it always clears panelOverrides, even if the
  // new value happens to match an override that was already set.
  const setGlobalGeminiRange = useCallback((value: GeminiRange) => { setGeminiRange(value); setPanelOverrides({}); }, []);
  const setPanelRange = useCallback((panel: PanelKey, value: GeminiRange) => setPanelOverrides((prev) => ({ ...prev, [panel]: value })), []);

  const refresh = useCallback(async (token: string, selectedRange: OverviewRange) => {
    if (!token) return;
    setStatus("loading");
    try {
      // Both Gemini Health windows are always computed server-side (see
      // readGeminiHeadline in dashboard.ts), so the global/per-panel 24h vs
      // 7d choice is resolved entirely client-side with no extra round trip.
      const response = await fetch(`/api/admin/analytics/overview?range=${selectedRange}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.status === 401) { setStatus("unauthorized"); return; }
      if (!response.ok) { setStatus("unavailable"); return; }
      setOverview(await response.json() as OverviewResponse);
      setStatus("idle");
    } catch {
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    if (!secret) return;
    void refresh(secret, range);
    const timer = window.setInterval(() => void refresh(secret, range), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh, secret, range]);

  const totalQuality = useMemo(() => overview?.quality.reduce((total, item) => total + item.value, 0) ?? 0, [overview]);
  const geminiDaysCovered = overview?.geminiHealth.days.length ?? 0;
  const operationAverages = useOperationAverages(overview?.geminiHealth.dailyOperations);
  const experienceComparison = useExperienceComparison(overview?.geminiHealth.dailyExperience, overview?.generatedAt);
  const routeComparisons = useRouteComparisons(overview?.geminiHealth.dailyRoutes, overview?.generatedAt);
  const scoreYieldComparison = useScoreYieldComparison(overview?.geminiHealth.dailyScoreYield, overview?.generatedAt);
  const metricsHeadline = overview?.geminiHealth.headline[effectiveRange("metrics")];
  const breakerHeadline = overview?.geminiHealth.headline[effectiveRange("breakerRow")];
  const performanceHeadline = overview?.geminiHealth.headline[effectiveRange("performance")];
  const modelsHeadline = overview?.geminiHealth.headline[effectiveRange("models")];
  // Sourced from the same toggle-aware per-model breakdown as the Models
  // table below, not the always-7-day `days` timeline -- otherwise these
  // cards silently ignored both the global and per-panel 24h/7d toggle.
  // Cost is summed only from models that have a price (see gemini-cost.ts);
  // an unpriced model no longer collapses the whole total to "Unpriced" --
  // it just narrows what the total covers, which allPriced below reports.
  const geminiTotals = useMemo(() => {
    const models = metricsHeadline?.models ?? [];
    let allPriced = models.length > 0;
    const totals = models.reduce((total, model) => {
      if (model.estimatedCostUsd === null) allPriced = false;
      return {
        requests: total.requests + model.requests,
        errors: total.errors + model.errors,
        tokens: total.tokens + model.totalTokens,
        cost: model.estimatedCostUsd === null ? total.cost : (total.cost ?? 0) + model.estimatedCostUsd,
      };
    }, { requests: 0, errors: 0, tokens: 0, cost: null as number | null });
    return { ...totals, allPriced };
  }, [metricsHeadline]);
  const scoreYieldRate = metricsHeadline?.scoreYield.total ? (metricsHeadline.scoreYield.confirmed + metricsHeadline.scoreYield.estimate) / metricsHeadline.scoreYield.total : null;
  // Always the 7d headline regardless of any panel's own toggle -- pairs
  // with Cloud Billing's geminiLast7Days for a real $/request figure, and
  // that BigQuery-sourced number only has a fixed 7d window to match against.
  const sevenDayGeminiRequestTotal = overview?.geminiHealth.headline["7d"].models.reduce((total, model) => total + model.requests, 0) ?? 0;
  // Framed as "model-confident" (higher is better) rather than "fallback
  // rate" -- inverse of confidenceStats.defaultConfidenceCount, which counts
  // the cases where Gemini omitted its own confidence and our default stood in.
  const modelConfidenceRate = breakerHeadline?.confidenceStats.total ? 1 - breakerHeadline.confidenceStats.defaultConfidenceCount / breakerHeadline.confidenceStats.total : null;
  const breakerTransitionsByOperation = useMemo(() => new Map(breakerHeadline?.breakerTransitions.map((item) => [item.operation, item]) ?? []), [breakerHeadline]);
  const breakerOperations = useMemo(() => (["preflight", "analyze"] as const).map((operation) => ({ operation, status: overview?.breaker?.[operation] ?? null, transitions: breakerTransitionsByOperation.get(operation) ?? null })), [overview, breakerTransitionsByOperation]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void refresh(secret, range);
  }

  if (!overview) {
    return <main className={styles.gate}><section className={styles.gateCard}>
      <p className={styles.eyebrow}>Sugar Camera · Internal</p>
      <h1>Live product analytics</h1>
      <p>Use the server-configured analytics admin secret. It is only held in this browser tab and is never persisted.</p>
      <form onSubmit={submit} className={styles.secretForm}>
        <label htmlFor="analytics-secret">Admin secret</label>
        <input id="analytics-secret" type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} />
        <button type="submit" disabled={!secret || status === "loading"}>{status === "loading" ? "Opening…" : "Open dashboard"}</button>
      </form>
      {status === "unauthorized" && <p className={styles.error} role="alert">The secret was not accepted.</p>}
      {status === "unavailable" && <p className={styles.error} role="alert">Analytics is unavailable or has not been configured yet.</p>}
    </section></main>;
  }

  return <main className={styles.page}>
    <div className={styles.stickyBar}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Sugar Camera · Internal</p>{view === "overview" && <><h1>Product pulse</h1><p className={styles.subhead}>{RANGE_LABELS[range]} · refreshes every 30 seconds</p></>}</div>
        <div className={styles.freshness}><span className={styles.liveDot} /> Updated {new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(overview.generatedAt))}<button onClick={() => void refresh(secret, range)} disabled={status === "loading"}>{status === "loading" ? "Refreshing…" : "Refresh"}</button></div>
      </header>

      <nav className={styles.tabs} aria-label="Analytics views"><button className={view === "overview" ? styles.tabActive : undefined} onClick={() => setView("overview")}>Product pulse</button><button className={view === "gemini" ? styles.tabActive : undefined} onClick={() => setView("gemini")}>Gemini Health</button></nav>

      {view === "overview" && <div className={styles.rangeTabs} aria-label="Product pulse date range">{(Object.keys(RANGE_LABELS) as OverviewRange[]).map((item) => <button key={item} className={range === item ? styles.rangeActive : undefined} onClick={() => setRange(item)}>{item === "all" ? "All time" : item}</button>)}</div>}

      {view === "gemini" && <div className={styles.healthHeading}><div><p className={styles.eyebrow}>Gemini Health</p><h2>{geminiRange === "24h" ? "Today's" : "Seven-day"} speed and reliability</h2><p>Separate Gemini time from server work and the user’s actual scanner experience.</p></div><div className={styles.rangeTabs} aria-label="Gemini Health date range"><button className={geminiRange === "24h" ? styles.rangeActive : undefined} onClick={() => setGlobalGeminiRange("24h")}>24h</button><button className={geminiRange === "7d" ? styles.rangeActive : undefined} onClick={() => setGlobalGeminiRange("7d")}>7d</button></div><span>{coverageLabel(geminiDaysCovered)}</span></div>}
    </div>

    {status === "unavailable" && <p className={styles.inlineError} role="alert">The last refresh failed; values below are from the previous successful update.</p>}

    {view === "overview" && <>
    <p className={styles.metricsGroupLabel}>Product funnel</p>
    <section aria-label="Product funnel metrics" className={styles.metrics}>
      {overview.metrics.filter((metric) => !GEMINI_METRIC_KEYS.has(metric.key)).map((metric) => <article className={styles.metricCard} key={metric.key}>
        <p>{metric.label}</p><strong>{formatValue(metric.value, metric.unit)}</strong>
        <span className={overview.window.allTime ? styles.neutral : deltaTone(metric.value, metric.previousValue, metric.key)}>{overview.window.allTime ? "All recorded data" : formatDelta(metric.value, metric.previousValue, range)}</span>
      </article>)}
    </section>
    <p className={styles.note}>“Scans started” and “Results shown” mark the start and the completion of the same flow, not two counts of the same thing. A scan that is abandoned or errors out before a result renders lowers “Results shown” without lowering “Scans started” — the two are not meant to always match.</p>
    <p className={styles.metricsGroupLabel}>Gemini reliability</p>
    <section aria-label="Gemini reliability metrics" className={styles.metrics}>
      {overview.metrics.filter((metric) => GEMINI_METRIC_KEYS.has(metric.key)).map((metric) => <article className={styles.metricCard} key={metric.key}>
        <p>{metric.label}</p><strong>{formatValue(metric.value, metric.unit)}</strong>
        <span className={overview.window.allTime ? styles.neutral : deltaTone(metric.value, metric.previousValue, metric.key)}>{overview.window.allTime ? "All recorded data" : formatDelta(metric.value, metric.previousValue, range)}</span>
      </article>)}
    </section>

    <section className={styles.secondaryGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Funnel</p><h2>Conversion rates</h2></div><span>{range === "all" ? "All time" : range}</span></div>
        <div className={styles.funnelList}>{overview.funnel.map((step) => {
          const tooFewSamples = step.denominator < MIN_RATE_SAMPLE;
          return <div key={step.label}><div><span>{step.label}</span><strong className={tooFewSamples ? styles.lowConfidence : undefined}>{formatPercent(step.rate)}</strong></div><small>{step.numerator} of {step.denominator} · {tooFewSamples ? "too few samples to trust yet" : overview.window.allTime || step.previousRate === null || step.rate === null ? "No prior baseline" : `${step.rate >= step.previousRate ? "+" : ""}${((step.rate - step.previousRate) * 100).toFixed(1)}pp`}</small></div>;
        })}</div>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Quality</p><h2>Result quality mix</h2></div><span>{totalQuality} shown</span></div>
        {overview.quality.length === 0 ? <p className={styles.empty}>No results in this window yet.</p> : <>
          {(() => {
            const noDetection = overview.quality.find((item) => item.label === "no_detection");
            const share = noDetection && totalQuality ? noDetection.value / totalQuality : 0;
            return share >= NO_DETECTION_ALERT_THRESHOLD ? <p className={styles.qualityAlert}>{formatPercent(share)} of scans found nothing at all</p> : null;
          })()}
          <div className={styles.qualityList}>{overview.quality.map((item) => <div key={item.label}><div><span>{formatEventName(item.label)}</span><strong className={item.label === "no_detection" ? styles.negative : undefined}>{item.value}</strong></div><i><b className={item.label === "no_detection" ? styles.qualityBarWarning : undefined} style={{ width: `${Math.max(2, (item.value / totalQuality) * 100)}%` }} /></i></div>)}</div>
        </>}
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Audience</p><h2>Unique installations</h2></div><span>Pseudonymous</span></div>
        <div className={styles.operationGrid}><div><span>DAU</span><strong>{overview.users.day}</strong></div><div><span>WAU</span><strong>{overview.users.week}</strong></div><div><span>MAU</span><strong>{overview.users.month}</strong></div></div>
        <p className={styles.panelNote}>Distinct browser installations with telemetry, not people. Clearing browser storage creates a new installation.</p>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Activity</p><h2>Recent events</h2></div><span>Last 12</span></div>
        {overview.recentEvents.length === 0 ? <p className={styles.empty}>No analytics events in this window yet.</p> : <ol className={styles.eventList}>{overview.recentEvents.map((event, index) => <li key={`${event.occurredAt}-${index}`}><span>{formatEventName(event.eventName)}</span><small>{event.source} · {new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(event.occurredAt))}</small></li>)}</ol>}
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Revenue</p><h2>Stripe ledger</h2></div><span>Source of truth</span></div>
        {overview.stripe.length === 0 ? <p className={styles.empty}>No Stripe payment events in this window yet.</p> : <div className={styles.financeList}>{overview.stripe.map((item) => <div key={item.currency}><div><strong>{item.currency}</strong><span>{item.paidCheckoutSessions} paid sessions · {item.refundedPayments} refunds</span></div><dl><div><dt>Gross</dt><dd>{formatMinor(item.grossMinor, item.currency)}</dd></div><div><dt>Refunded</dt><dd>{formatMinor(item.refundedMinor, item.currency)}</dd></div><div><dt>Net</dt><dd>{formatMinor(item.netMinor, item.currency)}</dd></div></dl></div>)}</div>}
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Gemini health</p><h2>Availability</h2></div><span>24h</span></div>
        <div className={styles.operationGrid}><div><span>Requests</span><strong>{overview.operations.visionRequests}</strong></div><div><span>Error rate</span><strong>{formatPercent(overview.operations.visionErrorRate)}</strong></div><div><span>p95 latency</span><strong>{overview.operations.visionP95Ms === null ? "—" : `${Math.round(overview.operations.visionP95Ms)} ms`}</strong></div></div>
        <p className={styles.panelNote}>Requests counts individual Gemini API calls (the quick preflight check plus the full analyze call), not user scans — one scan can trigger several of these, so this number naturally runs higher than "Scans started" above.</p>
        <button className={styles.panelLink} onClick={() => setView("gemini")}>Open 7-day Gemini Health →</button>
      </article>
    </section>
    <CloudBillingPanel billing={overview.cloudBilling} generatedAt={overview.generatedAt} sevenDayRequestTotal={sevenDayGeminiRequestTotal} dailyTokens={overview.geminiHealth.dailyTokens} />
    <p className={styles.note}>Gemini spend is an application-side estimate from recorded token usage. Cloud Billing reconciliation can be added later and may arrive with a delay.</p>
    </>}

    {view === "gemini" && <section className={styles.geminiHealth} aria-label="Gemini Health">
      <div className={styles.panelToggleRow}><span className={styles.panelToggleLabel}>Breaker &amp; quality signals</span><PanelRangeToggle value={effectiveRange("breakerRow")} onChange={(value) => setPanelRange("breakerRow", value)} /></div>
      <div className={styles.breakerRow}>{breakerOperations.map(({ operation, status, transitions }) => {
        // A flapping breaker can currently read "closed" and still be worth
        // flagging -- this suffix makes that visible instead of only
        // showing the live snapshot.
        const history = transitions && (transitions.opened > 0 || transitions.closed > 0) ? ` · ${transitions.opened}× opened / ${transitions.closed}× closed` : "";
        if (!status || status.state === "closed") return <span key={operation} className={styles.breakerBadgeClosed}>{formatOperationLabel(operation)}: {status?.currentModel ?? "primary model"} (primary){history}</span>;
        if (status.state === "open") return <span key={operation} className={styles.breakerBadgeOpen}>{formatOperationLabel(operation)}: failover active — {status.currentModel ?? "fallback model"}{status.sinceMs !== null ? ` since ${formatBreakerSince(status.sinceMs)}` : ""}{history}</span>;
        return <span key={operation} className={styles.breakerBadgeProbing}>{formatOperationLabel(operation)}: testing {status.currentModel ?? "primary model"} again…{history}</span>;
      })}{breakerHeadline?.hedgeStats.map((stat) => <span key={stat.operation} className={styles.breakerBadgeClosed}>{formatOperationLabel(stat.operation)} hedge: won {stat.won}/{stat.eligible} ({formatPercent(stat.eligible ? stat.won / stat.eligible : null)})</span>)}{!!breakerHeadline?.confidenceStats.total && <span className={styles.breakerBadgeClosed}>Model-confident: {formatPercent(modelConfidenceRate)} ({breakerHeadline.confidenceStats.total - breakerHeadline.confidenceStats.defaultConfidenceCount}/{breakerHeadline.confidenceStats.total})</span>}{!!breakerHeadline?.unbrandedDetectionCount && <span className={styles.breakerBadgeProbing} title="Temporary diagnostic, removed ~2026-09-16">Unbranded names logged: {breakerHeadline.unbrandedDetectionCount}</span>}</div>
      <p className={styles.panelNote}>"Hedge won X/Y" is a duplicate speculative Gemini call that sometimes finishes first. "Model-confident" is how often Gemini reported its own confidence score rather than the app substituting a default. "Unbranded names logged" is a temporary diagnostic.</p>
      <div className={styles.panelToggleRow}><span className={styles.panelToggleLabel}>Headline metrics</span><PanelRangeToggle value={effectiveRange("metrics")} onChange={(value) => setPanelRange("metrics", value)} /></div>
      <div className={styles.metrics}><article className={styles.metricCard}><p>Requests</p><strong>{geminiTotals.requests}</strong><span className={styles.neutral}>All operations</span></article><article className={styles.metricCard}><p>Error rate</p><strong>{formatPercent(geminiTotals.requests ? geminiTotals.errors / geminiTotals.requests : null)}</strong><span className={styles.neutral}>{geminiTotals.errors} failed</span></article><article className={styles.metricCard}><p>Provider tokens</p><strong>{formatValue(geminiTotals.tokens, "count")}</strong><span className={styles.neutral}>Usage-reported only</span></article><article className={styles.metricCard}><p>Estimated cost</p><strong>{formatBilling(geminiTotals.cost, "USD")}</strong><span className={styles.neutral}>{geminiTotals.allPriced ? "Application estimate" : "Application estimate · priced models only"}</span></article><article className={styles.metricCard}><p>Score yield</p><strong>{formatPercent(scoreYieldRate)}</strong><ComparisonBadges current={scoreYieldRate} yesterday={scoreYieldComparison.yesterday} average={scoreYieldComparison.average} lowerIsBetter={false} /><span className={styles.neutral}>{(metricsHeadline?.scoreYield.confirmed ?? 0) + (metricsHeadline?.scoreYield.estimate ?? 0)} of {metricsHeadline?.scoreYield.total ?? 0} detections scored</span></article></div>
      <p className={styles.panelNote}>Requests counts individual Gemini API calls (preflight plus analyze), not user scans — preflight is normally the majority of them.</p>
      <article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Protection limits</p><h2>Where requests were blocked</h2></div><span>{RANGE_LABELS[range]}</span></div>{overview.guardRejections.length === 0 ? <p className={styles.empty}>No protection limit has blocked work in this window.</p> : <div className={styles.guardTable}><div className={styles.comparisonHeader}><span>Scope</span><span>Protection</span><span>Dimension</span><span>Blocked</span><span>Prior window</span></div>{overview.guardRejections.map((item) => <div key={`${item.scope}-${item.guard}-${item.dimension ?? "none"}`}><strong>{formatEventName(item.scope)}</strong><span>{formatGuardName(item.guard)}</span><span>{item.dimension ? formatEventName(item.dimension) : "—"}</span><strong className={styles.negative}>{item.current}</strong><span>{item.previous}</span></div>)}</div>}<p className={styles.panelNote}>Counts begin with this deployment. They are aggregate safety decisions only: no IP addresses, installation IDs, images, or request payloads are stored.</p></article>
      <article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Day-to-day comparison</p><h2>Gemini speed by operation</h2></div><span>UTC · newest first</span></div>{overview.geminiHealth.dailyOperations.length === 0 ? <p className={styles.empty}>No persisted Gemini events in this window yet.</p> : <div className={styles.comparisonScroll}><div className={styles.comparisonTable}><div className={styles.comparisonHeader}><span>Day</span><span>Stage</span><span>Requests</span><span>Success</span><span>Timeout</span><span>p50 Gemini</span><span>p95 Gemini</span><span>p95 queue</span></div>{overview.geminiHealth.dailyOperations.map((item) => {
                const successRate = item.requests ? item.successes / item.requests : null;
                const timeoutRate = item.requests ? item.timeoutErrors / item.requests : null;
                // "Average" here means across every day this table currently
                // shows for the same operation — not the fixed Aug 26-27
                // archived window above, which stays as a separate, dated
                // reference point rather than a moving target.
                const average = operationAverages.get(item.operation);
                return <div key={`${item.day}-${item.operation}`}><time>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", weekday: "short" }).format(new Date(`${item.day}T00:00:00Z`))}</time><strong>{formatEventName(item.operation)}</strong><span>{item.requests}</span><span>{formatPercent(successRate)}{average && <small className={deltaPointsTone(successRate, average.successRate)}>{formatDeltaPoints(successRate, average.successRate)}</small>}</span><span>{formatPercent(timeoutRate)}{average && <small className={deltaPointsTone(timeoutRate, average.timeoutRate, true)}>{formatDeltaPoints(timeoutRate, average.timeoutRate)}</small>}</span><span>{formatMs(item.p50LatencyMs)}{average && <small className={relativeDeltaTone(item.p50LatencyMs, average.p50LatencyMs)}>{formatRelativeDelta(item.p50LatencyMs, average.p50LatencyMs)}</small>}</span><span>{formatMs(item.p95LatencyMs)}{average && <small className={relativeDeltaTone(item.p95LatencyMs, average.p95LatencyMs)}>{formatRelativeDelta(item.p95LatencyMs, average.p95LatencyMs)}</small>}</span><span>{formatMs(item.p95QueueMs)}{average && <small className={relativeDeltaTone(item.p95QueueMs, average.p95QueueMs)}>{formatRelativeDelta(item.p95QueueMs, average.p95QueueMs)}</small>}</span></div>;
              })}</div></div>}</article>
      <article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Day-to-day user experience</p><h2>What scanner users wait for</h2></div><span>p95 · client RTT</span></div>{overview.geminiHealth.dailyExperience.length === 0 ? <p className={styles.empty}>No completed scanner sessions in this window yet.</p> : <div className={styles.comparisonScroll}><div className={styles.experienceTable}><div className={styles.comparisonHeader}><span>Day</span><span>Completed scans</span><span>First pre-screen dispatch</span><span>Pre-screen RTT</span><span>Analysis RTT</span></div>{overview.geminiHealth.dailyExperience.map((item) => <div key={item.day}><time>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", weekday: "short" }).format(new Date(`${item.day}T00:00:00Z`))}</time><span>{item.completions}</span><span>{formatMs(item.p95FirstPreflightDispatchMs)}</span><span>{formatMs(item.p95PreflightRttMs)}</span><span>{formatMs(item.p95AnalyzeRttMs)}</span></div>)}</div></div>}</article>
      <div className={styles.panelToggleRow}><span className={styles.panelToggleLabel}>Scanner performance</span><PanelRangeToggle value={effectiveRange("performance")} onChange={(value) => setPanelRange("performance", value)} /></div>
      <section className={styles.performanceGrid} aria-label="Scanner end-to-end performance"><article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>User experience</p><h2>Scanner end-to-end</h2></div><span>{performanceHeadline?.experience.completions ?? 0} completions</span></div><div className={styles.operationGrid}><div><span>Capture ready p95</span><strong>{formatMs(performanceHeadline?.experience.p95CaptureReadyMs ?? null)}</strong></div><div><span>First pre-screen dispatch p95</span><strong>{formatMs(performanceHeadline?.experience.p95FirstPreflightDispatchMs ?? null)}</strong><ComparisonBadges current={performanceHeadline?.experience.p95FirstPreflightDispatchMs ?? null} yesterday={experienceComparison.yesterday?.p95FirstPreflightDispatchMs} average={experienceComparison.average?.p95FirstPreflightDispatchMs} /></div><div><span>Pre-screen RTT p95</span><strong>{formatMs(performanceHeadline?.experience.p95PreflightRttMs ?? null)}</strong><ComparisonBadges current={performanceHeadline?.experience.p95PreflightRttMs ?? null} yesterday={experienceComparison.yesterday?.p95PreflightRttMs} average={experienceComparison.average?.p95PreflightRttMs} /></div><div><span>Analysis RTT p95</span><strong>{formatMs(performanceHeadline?.experience.p95AnalyzeRttMs ?? null)}</strong><ComparisonBadges current={performanceHeadline?.experience.p95AnalyzeRttMs ?? null} yesterday={experienceComparison.yesterday?.p95AnalyzeRttMs} average={experienceComparison.average?.p95AnalyzeRttMs} /></div><div><span>Render p95</span><strong>{formatMs(performanceHeadline?.experience.p95RenderMs ?? null)}</strong></div></div><p className={styles.panelNote}>RTT includes network and application time measured in the browser; it is the closest view of what a scanner user feels. "Yesterday"/"7d avg" badges compare against the trailing 7 calendar days regardless of the 24h/7d toggle above, so there is always something to compare against.</p></article><article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Server route timings</p><h2>Where time is spent</h2></div><span>p95</span></div>{!performanceHeadline?.routes.length ? <p className={styles.empty}>No persisted scan-route events in this window yet.</p> : <div className={styles.routeList}>{performanceHeadline.routes.map((route) => {
        const comparison = routeComparisons.get(route.route);
        return <div key={route.route}><strong>{formatEventName(route.route)}</strong><span>{route.requests} requests · {route.errors} errors</span><small>Total {formatMs(route.p95DurationMs)} · Gemini {formatMs(route.p95VisionMs)} · catalog {formatMs(route.p95CatalogMs)}</small><ComparisonBadges current={route.p95DurationMs} yesterday={comparison?.yesterday?.p95DurationMs} average={comparison?.average?.p95DurationMs} /></div>;
      })}</div>}</article></section>
      {/* A <details> disclosure rather than an always-open table: today there is
          only one model, but this is where an A/B against a second model
          (e.g. while diagnosing a slowdown) will show up, and that shouldn't
          force a permanently-taller panel for the common one-model case. */}
      {/* Broken out by model+operation, not just model: the same model reads
          very differently on a cheap preflight gate vs a full analyze call
          (confirmed live during the 09-01 A/B — gemini-3.6-flash was ~0%
          success on preflight the same hour it was 100% on analyze), and an
          averaged single row hid exactly that. */}
      <details className={styles.widePanel} open={(modelsHeadline?.models.length ?? 0) > 1}><summary className={styles.panelHeading}><div><p className={styles.eyebrow}>Models</p><h2>{effectiveRange("models") === "24h" ? "Today's" : "Seven-day"} breakdown, by operation</h2></div><span>{new Set(modelsHeadline?.models.map((model) => model.model)).size} model(s) seen</span></summary><div className={styles.panelToggleRow}><span className={styles.panelToggleLabel}>By model</span><PanelRangeToggle value={effectiveRange("models")} onChange={(value) => setPanelRange("models", value)} /></div>{!modelsHeadline?.models.length ? <p className={styles.empty}>No Gemini provider events in this window yet.</p> : <div className={`${styles.comparisonScroll} ${styles.modelsScroll}`}><div className={styles.comparisonTable}><div className={styles.comparisonHeader}><span>Model</span><span>Operation</span><span>Requests</span><span>Success</span><span>Timeout</span><span>p50</span><span>p95</span><span>Tokens · cost</span></div>{modelsHeadline.models.map((model) => <div key={`${model.model}-${model.operation}`}><strong>{model.model}</strong><span>{formatEventName(model.operation)}</span><span>{model.requests}</span><span>{formatPercent(model.successRate)}</span><span>{model.requests ? formatPercent(model.timeoutErrors / model.requests) : "—"}</span><span>{formatMs(model.p50LatencyMs)}</span><span>{formatMs(model.p95LatencyMs)}</span><span>{formatValue(model.totalTokens, "count")} · {formatBilling(model.estimatedCostUsd, "USD")}</span></div>)}</div></div>}<p className={styles.panelNote}>Broken down by model and operation together, not per model alone — the same model can perform very differently on the cheap preflight check than on the full analyze call.</p></details>
      <p className={styles.note}>The panel reads aggregate telemetry only. Provider usage metadata can be absent for failed or cancelled calls; Cloud Billing remains the reconciliation source for actual spend.</p>
    </section>}
  </main>;
}
