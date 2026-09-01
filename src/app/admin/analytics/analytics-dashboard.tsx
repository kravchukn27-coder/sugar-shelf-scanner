"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./analytics-dashboard.module.css";
import type { DashboardOverview } from "@/lib/analytics/dashboard";

const REFRESH_MS = 30_000;
type OverviewRange = "24h" | "3d" | "7d" | "all";
const RANGE_LABELS: Record<OverviewRange, string> = { "24h": "Last 24 hours", "3d": "Last 3 days", "7d": "Last 7 days", all: "All time" };
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

function formatDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null) return "No priced usage";
  if (previous === 0) return current === 0 ? "No change" : "New";
  const percentage = ((current - previous) / previous) * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(0)}% vs prior 24h`;
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

// Sub-second values (queue time, render time) stay in milliseconds, where
// "94 ms" is a precise, meaningful number — rounding that to "0.1 s" loses
// exactly the "this is basically nothing" read it's meant to give. Anything
// a full second or slower switches to seconds, matching the "2.7 s" style
// already used in the Historical Railway logs table above.
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

// Percentage-point delta against the archived healthy-baseline window, shown
// inline on today's numbers so "is this normal?" doesn't require flipping
// back and forth to the historical comparison table above.
function formatDeltaPoints(current: number | null, baseline: number | null) {
  if (current === null || baseline === null) return null;
  const points = (current - baseline) * 100;
  if (Math.abs(points) < 1) return "≈ baseline";
  return `${points > 0 ? "+" : ""}${points.toFixed(0)}pp vs baseline`;
}

function deltaPointsTone(current: number | null, baseline: number | null) {
  if (current === null || baseline === null) return styles.neutral;
  const points = current - baseline;
  if (Math.abs(points) < 0.01) return styles.neutral;
  return points > 0 ? styles.positive : styles.negative;
}

export default function AnalyticsDashboard() {
  const [secret, setSecret] = useState("");
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "unauthorized" | "unavailable">("idle");
  const [view, setView] = useState<"overview" | "gemini">("overview");
  const [range, setRange] = useState<OverviewRange>("24h");

  const refresh = useCallback(async (token: string, selectedRange: OverviewRange) => {
    if (!token) return;
    setStatus("loading");
    try {
      const response = await fetch(`/api/admin/analytics/overview?range=${selectedRange}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.status === 401) { setStatus("unauthorized"); return; }
      if (!response.ok) { setStatus("unavailable"); return; }
      setOverview(await response.json() as DashboardOverview);
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
  const geminiTotals = useMemo(() => overview?.geminiHealth.days.reduce((total, day) => ({ requests: total.requests + day.requests, errors: total.errors + day.errors, tokens: total.tokens + day.totalTokens, cost: total.cost === null || day.estimatedCostUsd === null ? null : total.cost + day.estimatedCostUsd }), { requests: 0, errors: 0, tokens: 0, cost: 0 as number | null }) ?? { requests: 0, errors: 0, tokens: 0, cost: null }, [overview]);
  const geminiDaysCovered = overview?.geminiHealth.days.length ?? 0;
  const healthyBaselineSuccessRate = overview?.geminiHealth.historicalComparisons.find((item) => item.period.includes("healthy baseline"))?.successRate ?? null;

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
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Sugar Camera · Internal</p><h1>Product pulse</h1><p className={styles.subhead}>{RANGE_LABELS[range]} · refreshes every 30 seconds</p></div>
      <div className={styles.freshness}><span className={styles.liveDot} /> Updated {new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(overview.generatedAt))}<button onClick={() => void refresh(secret, range)} disabled={status === "loading"}>{status === "loading" ? "Refreshing…" : "Refresh"}</button></div>
    </header>

    {status === "unavailable" && <p className={styles.inlineError} role="alert">The last refresh failed; values below are from the previous successful update.</p>}

    <nav className={styles.tabs} aria-label="Analytics views"><button className={view === "overview" ? styles.tabActive : undefined} onClick={() => setView("overview")}>Product pulse</button><button className={view === "gemini" ? styles.tabActive : undefined} onClick={() => setView("gemini")}>Gemini Health</button></nav>

    {view === "overview" && <>
    <div className={styles.rangeTabs} aria-label="Product pulse date range">{(Object.keys(RANGE_LABELS) as OverviewRange[]).map((item) => <button key={item} className={range === item ? styles.rangeActive : undefined} onClick={() => setRange(item)}>{item === "all" ? "All time" : item}</button>)}</div>
    <p className={styles.metricsGroupLabel}>Product funnel</p>
    <section aria-label="Product funnel metrics" className={styles.metrics}>
      {overview.metrics.filter((metric) => !GEMINI_METRIC_KEYS.has(metric.key)).map((metric) => <article className={styles.metricCard} key={metric.key}>
        <p>{metric.label}</p><strong>{formatValue(metric.value, metric.unit)}</strong>
        <span className={overview.window.allTime ? styles.neutral : deltaTone(metric.value, metric.previousValue, metric.key)}>{overview.window.allTime ? "All recorded data" : formatDelta(metric.value, metric.previousValue)}</span>
      </article>)}
    </section>
    <p className={styles.metricsGroupLabel}>Gemini reliability</p>
    <section aria-label="Gemini reliability metrics" className={styles.metrics}>
      {overview.metrics.filter((metric) => GEMINI_METRIC_KEYS.has(metric.key)).map((metric) => <article className={styles.metricCard} key={metric.key}>
        <p>{metric.label}</p><strong>{formatValue(metric.value, metric.unit)}</strong>
        <span className={overview.window.allTime ? styles.neutral : deltaTone(metric.value, metric.previousValue, metric.key)}>{overview.window.allTime ? "All recorded data" : formatDelta(metric.value, metric.previousValue)}</span>
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
        <button className={styles.panelLink} onClick={() => setView("gemini")}>Open 7-day Gemini Health →</button>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Cloud Billing</p><h2>Actual billed spend</h2></div><span>{overview.cloudBilling.state === "available" ? "Daily export" : overview.cloudBilling.state.replaceAll("_", " ")}</span></div>
        {overview.cloudBilling.state === "not_configured" || overview.cloudBilling.state === "waiting_for_export" || overview.cloudBilling.state === "no_data" || overview.cloudBilling.state === "unavailable" ? <p className={styles.empty}>{overview.cloudBilling.state === "waiting_for_export" ? "Google has not published a billing table yet. It can take several hours after enabling export." : overview.cloudBilling.state === "no_data" ? "The billing table exists, but it has no reported cost rows for this project yet." : overview.cloudBilling.state === "not_configured" ? "Connect the read-only BigQuery service account to show billed spend." : "BigQuery could not be reached; the dashboard will retry automatically."}</p> : <><div className={styles.operationGrid}><div><span>Google · 24h</span><strong>{formatBilling(overview.cloudBilling.actualGoogleLast24Hours, overview.cloudBilling.currency)}</strong></div><div><span>Gemini · 24h</span><strong>{formatBilling(overview.cloudBilling.geminiLast24Hours, overview.cloudBilling.currency)}</strong></div><div><span>Gemini · 30d</span><strong>{formatBilling(overview.cloudBilling.geminiLast30Days, overview.cloudBilling.currency)}</strong></div></div><p className={styles.panelNote}>{overview.cloudBilling.state === "stale" ? "Warning: this export is more than 36 hours old. " : ""}Actual billed amounts include credits; the Gemini subset is matched from billing service/SKU names. Latest reported usage: {overview.cloudBilling.latestUsageAt ? new Date(overview.cloudBilling.latestUsageAt).toLocaleString() : "—"}.</p></>}
      </article>
    </section>
    <p className={styles.note}>Gemini spend is an application-side estimate from recorded token usage. Cloud Billing reconciliation can be added later and may arrive with a delay.</p>
    </>}

    {view === "gemini" && <section className={styles.geminiHealth} aria-label="Gemini Health">
      <div className={styles.healthHeading}><div><p className={styles.eyebrow}>Gemini Health</p><h2>Seven-day speed and reliability</h2><p>Separate Gemini time from server work and the user’s actual scanner experience.</p></div><span>{coverageLabel(geminiDaysCovered)}</span></div>
      <div className={styles.metrics}><article className={styles.metricCard}><p>Requests</p><strong>{geminiTotals.requests}</strong><span className={styles.neutral}>All operations</span></article><article className={styles.metricCard}><p>Error rate</p><strong>{formatPercent(geminiTotals.requests ? geminiTotals.errors / geminiTotals.requests : null)}</strong><span className={styles.neutral}>{geminiTotals.errors} failed</span></article><article className={styles.metricCard}><p>Provider tokens</p><strong>{formatValue(geminiTotals.tokens, "count")}</strong><span className={styles.neutral}>Usage-reported only</span></article><article className={styles.metricCard}><p>Estimated cost</p><strong>{formatBilling(geminiTotals.cost, "USD")}</strong><span className={styles.neutral}>Application estimate</span></article></div>
      <article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Protection limits</p><h2>Where requests were blocked</h2></div><span>{RANGE_LABELS[range]}</span></div>{overview.guardRejections.length === 0 ? <p className={styles.empty}>No protection limit has blocked work in this window.</p> : <div className={styles.guardTable}><div className={styles.comparisonHeader}><span>Scope</span><span>Protection</span><span>Dimension</span><span>Blocked</span><span>Prior window</span></div>{overview.guardRejections.map((item) => <div key={`${item.scope}-${item.guard}-${item.dimension ?? "none"}`}><strong>{formatEventName(item.scope)}</strong><span>{formatGuardName(item.guard)}</span><span>{item.dimension ? formatEventName(item.dimension) : "—"}</span><strong className={styles.negative}>{item.current}</strong><span>{item.previous}</span></div>)}</div>}<p className={styles.panelNote}>Counts begin with this deployment. They are aggregate safety decisions only: no IP addresses, installation IDs, images, or request payloads are stored.</p></article>
      <article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Historical Railway logs</p><h2>Baseline and incident comparison</h2></div><span>Archived aggregates</span></div><div className={styles.comparisonScroll}><div className={styles.historyTable}><div className={styles.comparisonHeader}><span>Window</span><span>Requests</span><span>Success</span><span>Pre-screen p50</span><span>Pre-screen timeout</span><span>Confidence</span></div>{overview.geminiHealth.historicalComparisons.map((item) => <div key={item.period}><strong>{item.period}</strong><span>{item.requests}</span><span>{formatPercent(item.successRate)}</span><span>{item.preflightP50Ms}</span><span>{formatPercent(item.preflightTimeoutRate)}</span><small>{item.note}</small></div>)}</div></div><p className={styles.panelNote}>These are verified aggregates from the August Railway investigation. Individual logs have expired, so p95, queue and Analyze splits are deliberately not inferred.</p></article>
      <article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Day-to-day comparison</p><h2>Gemini speed by operation</h2></div><span>UTC · newest first</span></div>{overview.geminiHealth.dailyOperations.length === 0 ? <p className={styles.empty}>No persisted Gemini events in this window yet.</p> : <div className={styles.comparisonScroll}><div className={styles.comparisonTable}><div className={styles.comparisonHeader}><span>Day</span><span>Stage</span><span>Requests</span><span>Success</span><span>Timeout</span><span>p50 Gemini</span><span>p95 Gemini</span><span>p95 queue</span></div>{overview.geminiHealth.dailyOperations.map((item) => {
                const successRate = item.requests ? item.successes / item.requests : null;
                // The archived baseline is a preflight-only measurement (see
                // the Historical Railway logs panel above), so the delta
                // badge only makes sense on preflight rows.
                const showBaselineDelta = item.operation === "preflight";
                return <div key={`${item.day}-${item.operation}`}><time>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", weekday: "short" }).format(new Date(`${item.day}T00:00:00Z`))}</time><strong>{formatEventName(item.operation)}</strong><span>{item.requests}</span><span>{formatPercent(successRate)}{showBaselineDelta && <small className={deltaPointsTone(successRate, healthyBaselineSuccessRate)}>{formatDeltaPoints(successRate, healthyBaselineSuccessRate)}</small>}</span><span>{formatPercent(item.requests ? item.timeoutErrors / item.requests : null)}</span><span>{formatMs(item.p50LatencyMs)}</span><span>{formatMs(item.p95LatencyMs)}</span><span>{formatMs(item.p95QueueMs)}</span></div>;
              })}</div></div>}</article>
      <article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Day-to-day user experience</p><h2>What scanner users wait for</h2></div><span>p95 · client RTT</span></div>{overview.geminiHealth.dailyExperience.length === 0 ? <p className={styles.empty}>No completed scanner sessions in this window yet.</p> : <div className={styles.comparisonScroll}><div className={styles.experienceTable}><div className={styles.comparisonHeader}><span>Day</span><span>Completed scans</span><span>First pre-screen dispatch</span><span>Pre-screen RTT</span><span>Analysis RTT</span></div>{overview.geminiHealth.dailyExperience.map((item) => <div key={item.day}><time>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", weekday: "short" }).format(new Date(`${item.day}T00:00:00Z`))}</time><span>{item.completions}</span><span>{formatMs(item.p95FirstPreflightDispatchMs)}</span><span>{formatMs(item.p95PreflightRttMs)}</span><span>{formatMs(item.p95AnalyzeRttMs)}</span></div>)}</div></div>}</article>
      <section className={styles.performanceGrid} aria-label="Scanner end-to-end performance"><article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>User experience</p><h2>Scanner end-to-end</h2></div><span>{overview.geminiHealth.experience.completions} completions</span></div><div className={styles.operationGrid}><div><span>Capture ready p95</span><strong>{formatMs(overview.geminiHealth.experience.p95CaptureReadyMs)}</strong></div><div><span>First pre-screen dispatch p95</span><strong>{formatMs(overview.geminiHealth.experience.p95FirstPreflightDispatchMs)}</strong></div><div><span>Pre-screen RTT p95</span><strong>{formatMs(overview.geminiHealth.experience.p95PreflightRttMs)}</strong></div><div><span>Analysis RTT p95</span><strong>{formatMs(overview.geminiHealth.experience.p95AnalyzeRttMs)}</strong></div><div><span>Render p95</span><strong>{formatMs(overview.geminiHealth.experience.p95RenderMs)}</strong></div></div><p className={styles.panelNote}>RTT includes network and application time measured in the browser; it is the closest view of what a scanner user feels.</p></article><article className={styles.widePanel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Server route timings</p><h2>Where time is spent</h2></div><span>p95</span></div>{overview.geminiHealth.routes.length === 0 ? <p className={styles.empty}>No persisted scan-route events in this window yet.</p> : <div className={styles.routeList}>{overview.geminiHealth.routes.map((route) => <div key={route.route}><strong>{formatEventName(route.route)}</strong><span>{route.requests} requests · {route.errors} errors</span><small>Total {formatMs(route.p95DurationMs)} · Gemini {formatMs(route.p95VisionMs)} · catalog {formatMs(route.p95CatalogMs)}</small></div>)}</div>}</article></section>
      {/* A <details> disclosure rather than an always-open table: today there is
          only one model, but this is where an A/B against a second model
          (e.g. while diagnosing a slowdown) will show up, and that shouldn't
          force a permanently-taller panel for the common one-model case. */}
      {/* Broken out by model+operation, not just model: the same model reads
          very differently on a cheap preflight gate vs a full analyze call
          (confirmed live during the 09-01 A/B — gemini-3.6-flash was ~0%
          success on preflight the same hour it was 100% on analyze), and an
          averaged single row hid exactly that. */}
      <details className={styles.widePanel} open={overview.geminiHealth.models.length > 1}><summary className={styles.panelHeading}><div><p className={styles.eyebrow}>Models</p><h2>Seven-day breakdown, by operation</h2></div><span>{new Set(overview.geminiHealth.models.map((model) => model.model)).size} model(s) seen</span></summary>{overview.geminiHealth.models.length === 0 ? <p className={styles.empty}>No Gemini provider events in this window yet.</p> : <div className={`${styles.comparisonScroll} ${styles.modelsScroll}`}><div className={styles.comparisonTable}><div className={styles.comparisonHeader}><span>Model</span><span>Operation</span><span>Requests</span><span>Success</span><span>Timeout</span><span>p50</span><span>p95</span><span>Tokens · cost</span></div>{overview.geminiHealth.models.map((model) => <div key={`${model.model}-${model.operation}`}><strong>{model.model}</strong><span>{formatEventName(model.operation)}</span><span>{model.requests}</span><span>{formatPercent(model.successRate)}</span><span>{model.requests ? formatPercent(model.timeoutErrors / model.requests) : "—"}</span><span>{formatMs(model.p50LatencyMs)}</span><span>{formatMs(model.p95LatencyMs)}</span><span>{formatValue(model.totalTokens, "count")} · {formatBilling(model.estimatedCostUsd, "USD")}</span></div>)}</div></div>}</details>
      <p className={styles.note}>The panel reads aggregate telemetry only. Provider usage metadata can be absent for failed or cancelled calls; Cloud Billing remains the reconciliation source for actual spend.</p>
    </section>}
  </main>;
}
