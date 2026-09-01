"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./analytics-dashboard.module.css";
import type { DashboardOverview } from "@/lib/analytics/dashboard";

const REFRESH_MS = 30_000;

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

export default function AnalyticsDashboard() {
  const [secret, setSecret] = useState("");
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "unauthorized" | "unavailable">("idle");

  const refresh = useCallback(async (token: string) => {
    if (!token) return;
    setStatus("loading");
    try {
      const response = await fetch("/api/admin/analytics/overview", {
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
    void refresh(secret);
    const timer = window.setInterval(() => void refresh(secret), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh, secret]);

  const totalQuality = useMemo(() => overview?.quality.reduce((total, item) => total + item.value, 0) ?? 0, [overview]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void refresh(secret);
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
      <div><p className={styles.eyebrow}>Sugar Camera · Internal</p><h1>Product pulse</h1><p className={styles.subhead}>Live 24-hour view · refreshes every 30 seconds</p></div>
      <div className={styles.freshness}><span className={styles.liveDot} /> Updated {new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(overview.generatedAt))}<button onClick={() => void refresh(secret)} disabled={status === "loading"}>{status === "loading" ? "Refreshing…" : "Refresh"}</button></div>
    </header>

    {status === "unavailable" && <p className={styles.inlineError} role="alert">The last refresh failed; values below are from the previous successful update.</p>}

    <section aria-label="Current metrics" className={styles.metrics}>
      {overview.metrics.map((metric) => <article className={styles.metricCard} key={metric.key}>
        <p>{metric.label}</p><strong>{formatValue(metric.value, metric.unit)}</strong>
        <span className={deltaTone(metric.value, metric.previousValue, metric.key)}>{formatDelta(metric.value, metric.previousValue)}</span>
      </article>)}
    </section>

    <section className={styles.secondaryGrid}>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Funnel</p><h2>Conversion rates</h2></div><span>24h</span></div>
        <div className={styles.funnelList}>{overview.funnel.map((step) => <div key={step.label}><div><span>{step.label}</span><strong>{formatPercent(step.rate)}</strong></div><small>{step.numerator} of {step.denominator} · {step.previousRate === null || step.rate === null ? "No prior baseline" : `${step.rate >= step.previousRate ? "+" : ""}${((step.rate - step.previousRate) * 100).toFixed(1)}pp`}</small></div>)}</div>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Quality</p><h2>Result quality mix</h2></div><span>{totalQuality} shown</span></div>
        {overview.quality.length === 0 ? <p className={styles.empty}>No results in this window yet.</p> : <div className={styles.qualityList}>{overview.quality.map((item) => <div key={item.label}><div><span>{formatEventName(item.label)}</span><strong>{item.value}</strong></div><i><b style={{ width: `${Math.max(2, (item.value / totalQuality) * 100)}%` }} /></i></div>)}</div>}
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
        <p className={styles.panelNote}>Latency is calculated from recorded provider request durations; a dash means no eligible observations.</p>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Cloud Billing</p><h2>Actual billed spend</h2></div><span>{overview.cloudBilling.state === "available" ? "Daily export" : overview.cloudBilling.state.replaceAll("_", " ")}</span></div>
        {overview.cloudBilling.state === "not_configured" || overview.cloudBilling.state === "waiting_for_export" || overview.cloudBilling.state === "no_data" || overview.cloudBilling.state === "unavailable" ? <p className={styles.empty}>{overview.cloudBilling.state === "waiting_for_export" ? "Google has not published a billing table yet. It can take several hours after enabling export." : overview.cloudBilling.state === "no_data" ? "The billing table exists, but it has no reported cost rows for this project yet." : overview.cloudBilling.state === "not_configured" ? "Connect the read-only BigQuery service account to show billed spend." : "BigQuery could not be reached; the dashboard will retry automatically."}</p> : <><div className={styles.operationGrid}><div><span>Google · 24h</span><strong>{formatBilling(overview.cloudBilling.actualGoogleLast24Hours, overview.cloudBilling.currency)}</strong></div><div><span>Gemini · 24h</span><strong>{formatBilling(overview.cloudBilling.geminiLast24Hours, overview.cloudBilling.currency)}</strong></div><div><span>Gemini · 30d</span><strong>{formatBilling(overview.cloudBilling.geminiLast30Days, overview.cloudBilling.currency)}</strong></div></div><p className={styles.panelNote}>{overview.cloudBilling.state === "stale" ? "Warning: this export is more than 36 hours old. " : ""}Actual billed amounts include credits; the Gemini subset is matched from billing service/SKU names. Latest reported usage: {overview.cloudBilling.latestUsageAt ? new Date(overview.cloudBilling.latestUsageAt).toLocaleString() : "—"}.</p></>}
      </article>
    </section>
    <p className={styles.note}>Gemini spend is an application-side estimate from recorded token usage. Cloud Billing reconciliation can be added later and may arrive with a delay.</p>
  </main>;
}
