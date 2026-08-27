/**
 * Privacy-safe, in-memory timing summary for one scanner run.
 *
 * This deliberately has no scan, frame, device, product, image, or error
 * identifiers. Callers must only send the payload after the server has opted
 * in with its capability response header.
 */
export type ScannerMetricsCompletion =
  | "analysis_completed"
  | "preflight_terminal"
  | "request_failure";

export type ScannerMetricsPayload = {
  completion: ScannerMetricsCompletion;
  captureReadyMs?: number;
  captureEncodeMs?: number;
  timeToFirstPreflightDispatchMs?: number;
  preflightLastRttMs?: number;
  preflightTotalRttMs?: number;
  analyzeRttMs?: number;
  renderMs?: number;
  preflightAttempts: number;
  motionSkipped: number;
  qualitySkipped: number;
};

type Clock = () => number;
type RequestStage = "preflight" | "analyze";

const DURATION_BUCKET_MS = 25;
const MAX_DURATION_MS = 60_000;
const MAX_PREFLIGHT_ATTEMPTS = 90;

function bucketDuration(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(MAX_DURATION_MS, Math.ceil(value / DURATION_BUCKET_MS) * DURATION_BUCKET_MS);
}

function elapsed(startedAt: number, now: number) {
  return bucketDuration(now - startedAt);
}

type RunContext = {
  startedAt: number;
  preflightAttempts: number;
  motionSkipped: number;
  qualitySkipped: number;
  captureReadyMs?: number;
  captureEncodeMs?: number;
  timeToFirstPreflightDispatchMs?: number;
  preflightLastRttMs?: number;
  preflightTotalRttMs?: number;
  analyzeRttMs?: number;
  renderStartedAt?: number;
  renderMs?: number;
  emitted: boolean;
};

/**
 * Own one context at a time. Resetting or discarding it makes a stale async
 * callback harmless; terminal() is idempotent so a UI state transition and a
 * later paint callback cannot produce duplicate summaries.
 */
export function createScannerMetrics(clock: Clock = () => performance.now()) {
  let context: RunContext | null = null;

  const setFirst = (key: "captureReadyMs" | "renderMs", value: number | undefined) => {
    if (context && context[key] === undefined && value !== undefined) context[key] = value;
  };

  return {
    reset() {
      context = { startedAt: clock(), preflightAttempts: 0, motionSkipped: 0, qualitySkipped: 0, emitted: false };
    },
    discard() {
      context = null;
    },
    markCaptureReady() {
      if (context) setFirst("captureReadyMs", elapsed(context.startedAt, clock()));
    },
    recordCaptureEncode(startedAt: number) {
      if (!context) return;
      // Sum CPU work across the preflight loop, then bucket/cap it. This is
      // intentionally not image size, image metadata, or a frame identifier.
      const duration = elapsed(startedAt, clock());
      if (duration === undefined) return;
      context.captureEncodeMs = Math.min(MAX_DURATION_MS, (context.captureEncodeMs ?? 0) + duration);
    },
    startRequest(stage: RequestStage) {
      const startedAt = clock();
      if (stage === "preflight" && context) {
        context.preflightAttempts = Math.min(MAX_PREFLIGHT_ATTEMPTS, context.preflightAttempts + 1);
        if (context.timeToFirstPreflightDispatchMs === undefined) {
          context.timeToFirstPreflightDispatchMs = elapsed(context.startedAt, startedAt);
        }
      }
      return startedAt;
    },
    recordQualitySkip() {
      if (context) context.qualitySkipped = Math.min(MAX_PREFLIGHT_ATTEMPTS, context.qualitySkipped + 1);
    },
    recordMotionSkip() {
      if (context) context.motionSkipped = Math.min(MAX_PREFLIGHT_ATTEMPTS, context.motionSkipped + 1);
    },
    finishRequest(stage: RequestStage, startedAt: number) {
      if (!context) return;
      const duration = elapsed(startedAt, clock());
      if (duration === undefined) return;
      if (stage === "preflight") {
        context.preflightLastRttMs = duration;
        context.preflightTotalRttMs = Math.min(MAX_DURATION_MS, (context.preflightTotalRttMs ?? 0) + duration);
      } else {
        context.analyzeRttMs = duration;
      }
    },
    startRender() {
      if (context && context.renderStartedAt === undefined) context.renderStartedAt = clock();
    },
    markRendered() {
      if (context) setFirst("renderMs", elapsed(context.renderStartedAt ?? clock(), clock()));
    },
    terminal(completion: ScannerMetricsCompletion): ScannerMetricsPayload | null {
      if (!context || context.emitted) return null;
      context.emitted = true;
      const payload: ScannerMetricsPayload = {
        completion,
        preflightAttempts: context.preflightAttempts,
        motionSkipped: context.motionSkipped,
        qualitySkipped: context.qualitySkipped,
      };
      if (context.captureReadyMs !== undefined) payload.captureReadyMs = context.captureReadyMs;
      if (context.captureEncodeMs !== undefined) payload.captureEncodeMs = bucketDuration(context.captureEncodeMs);
      if (context.timeToFirstPreflightDispatchMs !== undefined) payload.timeToFirstPreflightDispatchMs = context.timeToFirstPreflightDispatchMs;
      if (context.preflightLastRttMs !== undefined) payload.preflightLastRttMs = context.preflightLastRttMs;
      if (context.preflightTotalRttMs !== undefined) payload.preflightTotalRttMs = bucketDuration(context.preflightTotalRttMs);
      if (context.analyzeRttMs !== undefined) payload.analyzeRttMs = context.analyzeRttMs;
      if (context.renderMs !== undefined) payload.renderMs = context.renderMs;
      return payload;
    },
  };
}
