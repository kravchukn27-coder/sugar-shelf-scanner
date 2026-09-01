import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { queueAnalyticsEvent } from "@/lib/analytics/events";
import { isScannerMetricsEnabled } from "@/lib/env";

// `access_restore` is an email-guessing surface, so it is rate limited by the
// same keyed digest as the scan routes. `access_redeem` makes an outbound
// authenticated Stripe call per request, so it is rate limited by the same
// digest. Neither calls scanJsonResponse — its Server-Timing headers and
// scanner-metrics gating are specific to the camera routes — so both log
// through logAccessRequest below instead.
type ScanRoute = "preflight" | "analyze" | "recovery_label" | "access_restore" | "access_redeem";

type ScanRouteTiming = {
  route: ScanRoute;
  startedAt: number;
  status: number;
  visionMs?: number;
  catalogMs?: number;
  dbProbeMs?: number;
  catalogResolutionMs?: number;
};

type RateLimitConfig = {
  scope: ScanRoute;
  limit: number;
  windowMs: number;
  secret?: string;
};

type RateLimitBucket = { count: number; resetAt: number };

const MAX_RATE_LIMIT_KEYS = 5_000;
const processRateLimitSecret = randomUUID();
const rateLimitStoreKey = "__sugarScannerRateLimits";

function rateLimitStore(): Map<string, RateLimitBucket> {
  const host = globalThis as typeof globalThis & { [rateLimitStoreKey]?: Map<string, RateLimitBucket> };
  host[rateLimitStoreKey] ??= new Map<string, RateLimitBucket>();
  return host[rateLimitStoreKey];
}

function clientFingerprint(request: Request, secret?: string) {
  // Only a keyed digest is held in process memory. The raw forwarded address
  // never reaches logs, response headers, or the rate-limit store.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    ?? request.headers.get("x-real-ip")?.trim()
    ?? "unknown-client";
  return createHmac("sha256", secret ?? processRateLimitSecret).update(forwarded).digest("hex");
}

function clearExpiredBuckets(store: Map<string, RateLimitBucket>, now: number) {
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

/**
 * Per-process defensive quota. It deliberately bounds its storage and makes
 * no claim to be a distributed Railway-wide limiter; use Redis/database
 * backing before production traffic spans several instances.
 */
export function checkScanRateLimit(request: Request, config: RateLimitConfig) {
  const now = Date.now();
  const store = rateLimitStore();
  // The store is capped at a small size, so eagerly purge expired keyed
  // digests. This keeps client-derived state short-lived even at low traffic.
  clearExpiredBuckets(store, now);

  const key = `${config.scope}:${clientFingerprint(request, config.secret)}`;
  const current = store.get(key);
  if (current && current.resetAt > now) {
    current.count += 1;
    return {
      allowed: current.count <= config.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  // Refuse new fingerprints when the bounded store is saturated rather than
  // retaining unbounded client-derived data during an abuse burst.
  if (store.size >= MAX_RATE_LIMIT_KEYS) return { allowed: false, retryAfterSeconds: 1 };

  store.set(key, { count: 1, resetAt: now + config.windowMs });
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Structured stdout log for the access routes, mirroring scan_request's
 * duration/status/route shape. No email, token, or checkout session id: the
 * payment and restore payloads never reach this call.
 */
export function logAccessRequest(route: "access_restore" | "access_redeem", startedAt: number, status: number) {
  const metric = {
    event: "access_request",
    route,
    durationMs: Math.round(performance.now() - startedAt),
    status,
  };
  console.info(JSON.stringify(metric));
  const { event: eventName, ...properties } = metric;
  queueAnalyticsEvent({ eventName, source: "server", properties });
}

export function scanJsonResponse(body: unknown, init: ResponseInit, timing: ScanRouteTiming) {
  const durationMs = Math.round(performance.now() - timing.startedAt);
  const serverTiming = [
    `scan;dur=${durationMs}`,
    timing.visionMs === undefined ? null : `vision;dur=${Math.round(timing.visionMs)}`,
    timing.catalogMs === undefined ? null : `catalog;dur=${Math.round(timing.catalogMs)}`,
    timing.dbProbeMs === undefined ? null : `db_probe;dur=${Math.round(timing.dbProbeMs)}`,
    timing.catalogResolutionMs === undefined ? null : `catalog_resolution;dur=${Math.round(timing.catalogResolutionMs)}`,
  ].filter((value): value is string => value !== null).join(", ");
  const response = NextResponse.json(body, init);
  response.headers.set("Server-Timing", serverTiming);
  response.headers.set("Cache-Control", "no-store");
  // The client requires an explicit server-side opt-in even when a stale
  // bundle has its own telemetry flag enabled. Recovery routes never issue
  // scanner summaries, so do not advertise the measurement flag there.
  if ((timing.route === "preflight" || timing.route === "analyze") && isScannerMetricsEnabled()) {
    response.headers.set("X-Scanner-Metrics", "enabled");
  }
  // Route metrics deliberately contain only duration/status/component names;
  // no client IDs, frame IDs, products, image data, or provider payloads.
  const metric = {
    event: "scan_request",
    route: timing.route,
    durationMs,
    status: timing.status,
    visionMs: timing.visionMs === undefined ? undefined : Math.round(timing.visionMs),
    catalogMs: timing.catalogMs === undefined ? undefined : Math.round(timing.catalogMs),
    dbProbeMs: timing.dbProbeMs === undefined ? undefined : Math.round(timing.dbProbeMs),
    catalogResolutionMs: timing.catalogResolutionMs === undefined ? undefined : Math.round(timing.catalogResolutionMs),
  };
  console.info(JSON.stringify(metric));
  const { event: eventName, ...properties } = metric;
  queueAnalyticsEvent({ eventName, source: "server", properties });
  return response;
}
