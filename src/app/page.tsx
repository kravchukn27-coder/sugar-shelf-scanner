"use client";

import "./barcode-recovery.css";
import "./sugar-fit-results.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { SugarFitResultHandle, SugarFitResultsSheet } from "./sugar-fit-results";
import type { AnalyzeScanResponse, Detection, PreflightScanResponse } from "@/lib/contracts/scan";
import { formatSugarPer100g } from "@/lib/scoring/format-sugar";
import { createSugarScore } from "@/lib/scoring/sugar-score";
import { calculateSugarFit } from "@/lib/scoring/sugar-fit";
import { groupRepeatedDetections, sortDetectionGroupsBySugarFit, type DetectionGroup } from "@/lib/scan/deduplicate-detections";
import { getCenteredFrameCrop } from "@/lib/scan/frame-crop";
import { getCameraDiagnosticSnapshot, type CameraDiagnosticSnapshot } from "@/lib/scan/camera-diagnostics";
import { applyCameraView, getCameraControls, getCameraDeviceId, preferCameraCaptureQuality, rearCameraRequest, supportsTorch } from "@/lib/scan/media-capabilities";
import { shouldRunScannerScheduler, transitionScannerLifecycle, type ScannerLifecycleEvent, type ScannerLifecycleState } from "@/lib/scan/scanner-lifecycle";
import { createScannerMetrics, type ScannerMetricsCompletion } from "@/lib/scan/scanner-metrics";
import { sampleLuma } from "@/lib/scan/frame-stillness";
import { sampleFrameQuality } from "@/lib/scan/frame-quality";
import { createInitialLiveFrameBaseline, decideLiveFrameSchedulerTick } from "@/lib/scan/live-frame-scheduler";
import { decodeLocalBarcode, type RecoveryState } from "@/lib/recovery/local-recovery";
import { reportLocalBarcodeDecode } from "@/lib/recovery/recovery-decode-metrics";
import type { BarcodeRecoveryResponse, NutritionLabelDraft, NutritionLabelRecoveryResponse } from "@/lib/contracts/scan";
import { shouldOfferBarcodeRecovery } from "@/lib/recovery/recovery-ui";
import { catalogProposalErrorMessage, catalogProposalSubmissionOutcome, GENERIC_PROPOSAL_ERROR_MESSAGE } from "@/lib/recovery/catalog-proposal-ui";
import { getMockShelfScan, getSugarFitDemoScan, SUGAR_FIT_DEMO_IMAGE } from "@/lib/mock/scan-fixtures";

const FRAME_INTERVAL = 650;
const PREFLIGHT_CANDIDATE_CONFIDENCE_THRESHOLD = 0.65;
// Transient, non-blocking hints for the live viewfinder. Shown only after two
// consecutive same-reason skips so a flickering cause (e.g. blur one tick,
// glare the next) does not spam the copy. Deliberately text-only: the framed
// .viewfinder-guide this once paired with was removed for always showing a
// clean fullscreen preview (see camera-frame-regression-plan).
const LIVE_HINT_COPY = {
  motion: "Hold still for a second",
  blur: "Hold still for a second",
  dark: "Move to better light",
  glare: "Reduce glare — tilt the product",
  uncertain: "Getting a closer look…",
} as const;
type LiveHintReason = keyof typeof LIVE_HINT_COPY;
const LIVE_HINT_STREAK_THRESHOLD = 2;
const clientScannerMetricsEnabled = process.env.NEXT_PUBLIC_SCANNER_METRICS_ENABLED === "true";
// Default-on for live camera; set NEXT_PUBLIC_FRAME_QUALITY_ENABLED=false for fast rollback.
const clientFrameQualityEnabled = process.env.NEXT_PUBLIC_FRAME_QUALITY_ENABLED !== "false";
// Roll out the earlier stillness baseline independently; disabled preserves
// the existing scheduler timing while retaining the new code path in tests.
const immediateBaselineEnabled = process.env.NEXT_PUBLIC_IMMEDIATE_BASELINE_ENABLED === "true";
const bandCopy = { green: "Low sugar", yellow: "Moderate sugar", orange: "High sugar", red: "Very high sugar", unknown: "Needs a check" } as const;
const sourceCopy = { curated: "Sugar catalog", open_food_facts: "Open Food Facts", usda_food_data_central: "USDA FoodData Central", commercial: "Verified provider" } as const;
const meterPosition = { green: "12.5%", yellow: "37.5%", orange: "62.5%", red: "87.5%", unknown: null } as const;
const eligible = (d: Detection) => d.confidence >= .55 && Boolean(d.visualCandidate.brand || d.visualCandidate.name);
const displaySugar = (value: number | null | undefined) => formatSugarPer100g(value) ?? "—";
function Chevron({ up = false }: { up?: boolean }) { return <svg aria-hidden="true" className={up ? "chevron up" : "chevron"} viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>; }
function TorchIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6l-1 6h3l-7 12 1-8H8z" /></svg>; }
function BarcodeIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14M12 5v14" /></svg>; }
type RecoveryInfo = { id: string; state: RecoveryState; labelSeen: boolean; barcode: string | null };

async function scanFailureMessage(response: Response) {
  const payload = await response.json().catch(() => null) as { code?: unknown } | null;
  if (payload?.code === "rate_limited") return "Too many scans — wait a moment and try again";
  if (payload?.code === "provider_timeout") return "This scan took too long — try a closer photo";
  if (payload?.code === "bad_image") return "This photo couldn’t be processed — choose another one";
  return "Couldn’t analyze this capture";
}

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null), uploadPreviewRef = useRef<HTMLImageElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), streamRef = useRef<MediaStream | null>(null), abortRef = useRef<AbortController | null>(null), inFlight = useRef(false), session = useRef(0), frame = useRef(0), recoveryAttempt = useRef(0), preferredCameraDeviceId = useRef<string | null>(null), scannerMetrics = useRef(createScannerMetrics()), scannerMetricsEnabled = useRef(false), stillnessFingerprint = useRef<Uint8ClampedArray | null>(null), stillnessCanvas = useRef<HTMLCanvasElement | null>(null), qualitySkipStreak = useRef(0), motionSkipStreak = useRef(0), liveHintStreak = useRef<{ reason: LiveHintReason | null; count: number }>({ reason: null, count: 0 });
  const [state, setState] = useState<ScannerLifecycleState>("camera_off");
  const [liveHint, setLiveHint] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [scan, setScan] = useState<AnalyzeScanResponse | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  // Uploads do not have a live-frame scheduler to communicate activity. Keep
  // this distinct from the lifecycle so the spinner can begin while preflight
  // is running, before Gemini has found a candidate worth announcing.
  const [uploadBusy, setUploadBusy] = useState(false);
  const [cameraDiagnostics, setCameraDiagnostics] = useState<CameraDiagnosticSnapshot | null>(null);
  const [showCameraDiagnostics, setShowCameraDiagnostics] = useState(false);
  // Forces React to unmount and recreate the <video> DOM node on every new
  // camera session. Confirmed on-device: reusing the same node across a
  // getUserMedia retry left WebKit painting a stale decoder surface (visible
  // as black bars) even though the stream's own settings were unchanged; a
  // full page reload — which recreates the node — cleared it. Bumped instead
  // of just swapping srcObject on the existing element.
  const [cameraKey, setCameraKey] = useState(0);
  // Temporary: layout-only probe for the black-bars-after-retry investigation.
  // Confirms whether the <video> box itself has shrunk vs. its container,
  // rather than the camera stream's pixel content changing. Remove once the
  // root cause is confirmed and fixed.
  const [videoLayoutProbe, setVideoLayoutProbe] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false), [torchOn, setTorchOn] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null);
  const [recoveryCamera, setRecoveryCamera] = useState<{ id: string; mode: "package" | "label" } | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryCameraReady, setRecoveryCameraReady] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [recoverySubmissionBanner, setRecoverySubmissionBanner] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<NutritionLabelDraft | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState<"identifying" | "catalog" | "slow">("identifying");
  const [deferAutoResults, setDeferAutoResults] = useState(false);
  const groups = groupRepeatedDetections((scan?.detections ?? []).filter(eligible));
  const rankedGroups = sortDetectionGroupsBySugarFit(groups);
  const dispatch = useCallback((event: ScannerLifecycleEvent) => setState((current) => transitionScannerLifecycle(current, event)), []);
  const resetScanMetrics = useCallback(() => { scannerMetricsEnabled.current = false; scannerMetrics.current.reset(); }, []);
  const noteMetricsCapability = useCallback((response: Response) => { if (clientScannerMetricsEnabled && response.headers.get("X-Scanner-Metrics") === "enabled") scannerMetricsEnabled.current = true; }, []);
  const completeScanMetrics = useCallback((id: number, completion: ScannerMetricsCompletion) => {
    if (id !== session.current || !scannerMetricsEnabled.current) return;
    scannerMetrics.current.startRender();
    window.requestAnimationFrame(() => {
      if (id !== session.current || !scannerMetricsEnabled.current) return;
      scannerMetrics.current.markRendered();
      const payload = scannerMetrics.current.terminal(completion);
      if (!payload) return;
      const body = JSON.stringify(payload);
      const beaconSent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/scan/metrics", new Blob([body], { type: "application/json" }));
      if (!beaconSent) void fetch("/api/scan/metrics", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    });
  }, []);
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (demo !== "sugar-fit" && demo !== "sugar-fit-multi") return;
    const demoScan = demo === "sugar-fit-multi" ? getMockShelfScan("demo-multi") : getSugarFitDemoScan();
    setFrozen(SUGAR_FIT_DEMO_IMAGE);
    setDeferAutoResults(true);
    setState("captured_analyzing");
    const showCollapsedResult = window.setTimeout(() => {
      setScan(demoScan);
      setState("results");
    }, 3200);
    const openProduct = window.setTimeout(() => setDeferAutoResults(false), 6400);
    return () => {
      window.clearTimeout(showCollapsedResult);
      window.clearTimeout(openProduct);
    };
  }, []);
  const stopStream = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; inFlight.current = false; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setTorchOn(false); setTorchAvailable(false); setCameraDiagnostics(null); if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; } }, []);
  const clearResult = useCallback(() => { setRecovery(null); setRecoveryCamera(null); setRecoveryBusy(false); setRecoveryMessage(null); setRecoverySubmissionBanner(null); setLabelDraft(null); setScan(null); setFrozen(null); setFailure(null); setSheet(false); setSelected(null); setUploadBusy(false); }, []);
  const turnTorchOffAfterCapture = useCallback(async () => { const track = streamRef.current?.getVideoTracks()[0]; if (!torchOn || !track) return; try { await track.applyConstraints({ advanced: [{ torch: false } as unknown as MediaTrackConstraintSet] }); setTorchOn(false); } catch { setTorchAvailable(false); setTorchOn(false); } }, [torchOn]);
  // `uncertain` shows immediately (it already cost a real Gemini round trip);
  // a local skip reason only surfaces after two consecutive same-reason ticks
  // so a cause flickering between blur and glare frame-to-frame doesn't spam copy.
  const noteLiveHint = useCallback((reason: LiveHintReason | null) => {
    if (reason === "uncertain") { liveHintStreak.current = { reason: null, count: 0 }; setLiveHint(LIVE_HINT_COPY.uncertain); return; }
    if (!reason) { liveHintStreak.current = { reason: null, count: 0 }; setLiveHint(null); return; }
    const streak = liveHintStreak.current;
    const count = streak.reason === reason ? streak.count + 1 : 1;
    liveHintStreak.current = { reason, count };
    if (count >= LIVE_HINT_STREAK_THRESHOLD) setLiveHint(LIVE_HINT_COPY[reason]);
  }, []);

  const capture = useCallback((source: HTMLVideoElement | HTMLImageElement, width: number, quality: number, zoom = 1) => {
    const canvas = canvasRef.current; const w = "videoWidth" in source ? source.videoWidth : source.naturalWidth; const h = "videoHeight" in source ? source.videoHeight : source.naturalHeight;
    // The detached Image used for uploads has no layout box. Analyze the same
    // crop that the visible upload preview uses, otherwise Gemini's normalized
    // boxes cannot line up with portrait photos on screen.
    const preview = source instanceof HTMLImageElement ? uploadPreviewRef.current?.getBoundingClientRect() ?? source.getBoundingClientRect() : source.getBoundingClientRect();
    const crop = getCenteredFrameCrop(w, h, preview.width, preview.height, zoom);
    if (!canvas || !crop) return null;
    canvas.width = width; canvas.height = Math.max(1, Math.round(width / crop.aspect)); canvas.getContext("2d")?.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }, []);

  const sampleLiveFrame = useCallback((video: HTMLVideoElement) => {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null;
    const canvas = stillnessCanvas.current ?? (stillnessCanvas.current = document.createElement("canvas"));
    canvas.width = 16; canvas.height = 12;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return { luma: sampleLuma(ctx, canvas.width, canvas.height), data };
    } catch {
      // iOS can briefly expose a playing video before its pixels are readable.
      return null;
    }
  }, []);

  const analyze = useCallback(async (source: HTMLVideoElement | HTMLImageElement, id: number) => {
    // The final frame uses a modest centred crop after preflight.
    const encodeStartedAt = performance.now();
    const image = capture(source, 960, .7, 1.12); scannerMetrics.current.recordCaptureEncode(encodeStartedAt); if (!image || id !== session.current) return;
    // Keep the exact JPEG sent to Gemini for both camera and gallery scans.
    // Detection boxes and per-product thumbnails then share one coordinate
    // system instead of being remapped onto the uncropped gallery original.
    setFrozen(image);
    if (source instanceof HTMLVideoElement) void turnTorchOffAfterCapture();
    inFlight.current = true;
    noteLiveHint(null);
    dispatch("CAPTURED");
    const controller = new AbortController(); abortRef.current = controller;
    const requestStartedAt = scannerMetrics.current.startRequest("analyze");
    let requestTimingFinished = false;
    const finishRequestTiming = () => { if (!requestTimingFinished) { scannerMetrics.current.finishRequest("analyze", requestStartedAt); requestTimingFinished = true; } };
    try {
      const response = await fetch("/api/scan/analyze", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", context: "shelf", clientFrameId: `frame-${++frame.current}` }) });
      finishRequestTiming(); noteMetricsCapability(response);
      if (id !== session.current) return;
      if (!response.ok) { setFailure(await scanFailureMessage(response)); dispatch("ANALYZE_FAILURE"); completeScanMetrics(id, "request_failure"); return; }
      const result = await response.json() as AnalyzeScanResponse;
      if (id !== session.current) return;
      if (result.detections.some(eligible)) { setScan(result); dispatch("ANALYZE_SUCCESS"); } else { setFailure("No recognizable packaged products found"); dispatch("NO_SCENE"); }
      completeScanMetrics(id, "analysis_completed");
    } catch (error) { finishRequestTiming(); if (id === session.current && !(error instanceof DOMException && error.name === "AbortError")) { setFailure("Couldn’t analyze this frame"); dispatch("ANALYZE_FAILURE"); completeScanMetrics(id, "request_failure"); } }
    finally {
      if (id === session.current && source instanceof HTMLImageElement) setUploadBusy(false);
      if (id === session.current && abortRef.current === controller) { inFlight.current = false; abortRef.current = null; }
    }
  }, [capture, completeScanMetrics, dispatch, noteLiveHint, noteMetricsCapability, turnTorchOffAfterCapture]);

  const preflight = useCallback(async (source: HTMLVideoElement | HTMLImageElement) => {
    if (inFlight.current || sheet || !shouldRunScannerScheduler(state)) return;
    const encodeStartedAt = performance.now();
    const image = capture(source, 448, .55); scannerMetrics.current.recordCaptureEncode(encodeStartedAt); if (!image) return;
    const id = session.current; inFlight.current = true; const controller = new AbortController(); abortRef.current = controller;
    const requestStartedAt = scannerMetrics.current.startRequest("preflight");
    let requestTimingFinished = false;
    const finishRequestTiming = () => { if (!requestTimingFinished) { scannerMetrics.current.finishRequest("preflight", requestStartedAt); requestTimingFinished = true; } };
    try {
      const response = await fetch("/api/scan/preflight", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", context: "shelf", clientFrameId: `preflight-${++frame.current}` }) });
      finishRequestTiming(); noteMetricsCapability(response);
      if (id !== session.current) return;
      if (!response.ok) { if (source instanceof HTMLImageElement) setUploadBusy(false); setFailure("Couldn’t check this scene"); dispatch("ANALYZE_FAILURE"); completeScanMetrics(id, "request_failure"); return; }
      const result = await response.json() as PreflightScanResponse;
      if (id !== session.current) return;
      if (result.decision !== "candidate" || result.packagedProductCount < 1 || result.confidence < PREFLIGHT_CANDIDATE_CONFIDENCE_THRESHOLD) {
        const isUpload = source instanceof HTMLImageElement;
        if (isUpload) setUploadBusy(false);
        if (!isUpload && result.decision === "uncertain") { noteLiveHint("uncertain"); return; }
        noteLiveHint(null);
        setFailure(result.decision === "uncertain" ? "Move closer to a packaged product" : "No packaged products detected\nMove your camera closer");
        dispatch("NO_SCENE");
        completeScanMetrics(id, "preflight_terminal");
        return;
      }
      await analyze(source, id);
    } catch (error) { finishRequestTiming(); if (id === session.current && !(error instanceof DOMException && error.name === "AbortError")) { if (source instanceof HTMLImageElement) setUploadBusy(false); setFailure("Couldn’t check this scene"); dispatch("ANALYZE_FAILURE"); completeScanMetrics(id, "request_failure"); } }
    finally {
      // Full analysis owns its own controller. Do not clear inFlight here once
      // it has begun: that would let an upload/live scheduler start another
      // request or make Close unable to abort the full Gemini request.
      if (id === session.current && abortRef.current === controller) { inFlight.current = false; abortRef.current = null; }
    }
  }, [analyze, capture, completeScanMetrics, dispatch, noteLiveHint, noteMetricsCapability, sheet, state]);

  const start = useCallback(async () => {
    const id = ++session.current; stillnessFingerprint.current = null; qualitySkipStreak.current = 0; motionSkipStreak.current = 0; liveHintStreak.current = { reason: null, count: 0 }; setLiveHint(null); stopStream(); clearResult(); resetScanMetrics(); setUploadUrl(null); setCameraKey((key) => key + 1); setState((current) => transitionScannerLifecycle(current, current === "camera_off" ? "START" : "RETRY"));
    try {
      // A device ID is a best-effort way to keep the same browser-selected rear
      // source across retry. If iOS no longer exposes it, fall back to rear.
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia(rearCameraRequest(preferredCameraDeviceId.current)); }
      catch (error) {
        if (!preferredCameraDeviceId.current) throw error;
        preferredCameraDeviceId.current = null;
        stream = await navigator.mediaDevices.getUserMedia(rearCameraRequest());
      }
      if (id !== session.current || !videoRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      preferredCameraDeviceId.current = getCameraDeviceId(track) ?? preferredCameraDeviceId.current;
      try { await preferCameraCaptureQuality(track); } catch { /* Retain Safari's selected mode if its quality preference is unsupported. */ }
      let controls = getCameraControls(track);
      if (controls.standardZoom !== null) { try { await applyCameraView(track, controls, "standard"); } catch { controls = { ...controls, standardZoom: null, closerZoom: null }; } }
      setTorchAvailable(controls.torchAvailable); setCameraDiagnostics(getCameraDiagnosticSnapshot(track)); videoRef.current.srcObject = stream; await videoRef.current.play();
      if (id === session.current) {
        scannerMetrics.current.markCaptureReady();
        stillnessFingerprint.current = createInitialLiveFrameBaseline(immediateBaselineEnabled, sampleLiveFrame(videoRef.current)?.luma ?? null);
      }
      if (id !== session.current) { stream.getTracks().forEach((t) => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; streamRef.current = null; }
    }
    catch { if (id === session.current) { setFailure("Camera unavailable. Check permission and try again."); setState((current) => transitionScannerLifecycle(current, "ANALYZE_FAILURE")); } }
  }, [clearResult, resetScanMetrics, sampleLiveFrame, stopStream]);
  const close = useCallback(() => { session.current += 1; stillnessFingerprint.current = null; qualitySkipStreak.current = 0; motionSkipStreak.current = 0; liveHintStreak.current = { reason: null, count: 0 }; setLiveHint(null); scannerMetricsEnabled.current = false; scannerMetrics.current.discard(); stopStream(); clearResult(); setUploadUrl(null); dispatch("CLOSE_CAMERA"); }, [clearResult, dispatch, stopStream]);
  const toggleTorch = useCallback(async () => { const track = streamRef.current?.getVideoTracks()[0]; const next = !torchOn; if (!track || !supportsTorch(track)) return setTorchAvailable(false); try { await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] }); setTorchOn(next); } catch { setTorchAvailable(false); setTorchOn(false); } }, [torchOn]);
  const retry = useCallback(() => { if (!uploadUrl) void start(); else { session.current += 1; stillnessFingerprint.current = null; qualitySkipStreak.current = 0; motionSkipStreak.current = 0; liveHintStreak.current = { reason: null, count: 0 }; setLiveHint(null); clearResult(); resetScanMetrics(); setUploadBusy(true); dispatch("RETRY"); } }, [clearResult, dispatch, resetScanMetrics, start, uploadUrl]);
  const startRecovery = useCallback((id: string, mode: "package" | "label" = "package") => {
    session.current += 1;
    stillnessFingerprint.current = null;
    qualitySkipStreak.current = 0; motionSkipStreak.current = 0;
    liveHintStreak.current = { reason: null, count: 0 };
    setLiveHint(null);
    const recoverySession = session.current;
    const recoveryToken = ++recoveryAttempt.current;
    scannerMetricsEnabled.current = false; scannerMetrics.current.discard();
    stopStream();
    setCameraKey((key) => key + 1);
    setSheet(false); setRecoverySubmissionBanner(null); setRecovery({ id, state: "searching", labelSeen: false, barcode: null });
    setRecoveryMessage(null); setLabelDraft(null); setRecoveryCameraReady(false); setRecoveryCamera({ id, mode });
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(rearCameraRequest());
        if (recoverySession !== session.current || recoveryToken !== recoveryAttempt.current || !videoRef.current) return stream.getTracks().forEach((track) => track.stop());
        const track = stream.getVideoTracks()[0];
        try { await preferCameraCaptureQuality(track); } catch { /* Use the device-selected recovery capture quality. */ }
        streamRef.current = stream; videoRef.current.srcObject = stream; await videoRef.current.play();
        if (recoverySession !== session.current || recoveryToken !== recoveryAttempt.current) return stream.getTracks().forEach((cameraTrack) => cameraTrack.stop());
        setRecoveryCameraReady(videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0);
        if (videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
          setRecoveryMessage("Camera is still starting…");
          videoRef.current.addEventListener("loadeddata", () => {
            if (recoverySession === session.current && recoveryToken === recoveryAttempt.current && videoRef.current?.videoWidth && videoRef.current.videoHeight) { setRecoveryCameraReady(true); setRecoveryMessage(null); }
          }, { once: true });
        }
      } catch { if (recoverySession === session.current && recoveryToken === recoveryAttempt.current) { setRecoveryCameraReady(false); setRecoveryMessage("Camera unavailable. Check permission and try again."); } }
    })();
  }, [stopStream]);
  const captureRecovery = useCallback(async () => {
    const camera = recoveryCamera; const video = videoRef.current; const canvas = canvasRef.current;
    if (!camera || !video || !canvas || recoveryBusy || !recoveryCameraReady) return;
    const recoveryToken = recoveryAttempt.current;
    setRecoveryBusy(true); setRecoveryMessage(camera.mode === "package" ? "Reading barcode on this device…" : "Reading the nutrition label…");
    try {
      const image = capture(video, 1280, .82);
      if (!image) throw new Error("capture");
      // Both a direct label capture and the barcode fallback use the exact
      // same still. Consent is requested only after the local barcode reader
      // has failed, so the package image never leaves the device otherwise.
      const requestNutritionLabel = async (consentMessage: string, declinedMessage: string) => {
        const consented = window.confirm(consentMessage);
        if (!consented) { setRecoveryMessage(declinedMessage); return; }
        if (recoveryToken !== recoveryAttempt.current) return;
        const response = await fetch("/api/scan/recovery-label", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", labelCaptureConsented: true }) });
        if (recoveryToken !== recoveryAttempt.current) return;
        const result = await response.json() as NutritionLabelRecoveryResponse;
        if (recoveryToken !== recoveryAttempt.current) return;
        if (!response.ok || result.outcome === "unreadable") { setRecoveryMessage("Nutrition label was not readable. Retake for one new request."); return; }
        setLabelDraft(result.draft); setRecoveryMessage("Review the draft, edit any fields, then submit for curator review.");
      };
      if (camera.mode === "package") {
        const response = await fetch(image); const blob = await response.blob();
        const barcode = await decodeLocalBarcode(blob, undefined, undefined, (outcome) => reportLocalBarcodeDecode(clientScannerMetricsEnabled, outcome));
        if (recoveryToken !== recoveryAttempt.current) return;
        if (!barcode) {
          // Preserve the manual recovery state even if consent is declined or
          // extraction fails, while offering the captured still as a one-tap
          // consented fallback instead of requiring a second photo.
          setRecovery((current) => current?.id === camera.id ? { ...current, state: "barcode_not_found" } : current);
          await requestNutritionLabel("Barcode wasn’t recognised. Send this same photo to Gemini to extract nutrition details? It is not stored by this app.", "Barcode not recognised. Nothing was sent. Retake or take a nutrition-label photo.");
          return;
        }
        setRecovery((current) => current?.id === camera.id ? { ...current, state: "barcode_found", barcode } : current);
        const lookup = await fetch("/api/scan/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gtin: barcode }) });
        if (recoveryToken !== recoveryAttempt.current) return;
        if (!lookup.ok) throw new Error("lookup");
        const result = await lookup.json() as BarcodeRecoveryResponse;
        if (recoveryToken !== recoveryAttempt.current) return;
        if (result.status === "confirmed" && result.product) {
          setScan((current) => current ? { ...current, detections: current.detections.map((detection) => detection.id === camera.id ? { ...detection, status: "confirmed", product: result.product, score: result.score, estimateReason: result.estimateReason, visualCandidate: { ...detection.visualCandidate, gtin: barcode } } : detection) } : current);
          setRecoveryCamera(null); stopStream(); setSheet(true); setSelected(camera.id);
        } else { setRecoveryMessage("Barcode is not in the confirmed catalog. Photograph the nutrition label to continue."); setRecovery((current) => current?.id === camera.id ? { ...current, state: "barcode_not_found", barcode } : current); }
      } else await requestNutritionLabel("Send this single nutrition-label photo to Gemini for extraction? It is not stored by this app.", "Capture cancelled. Nothing was sent.");
    } catch { if (recoveryToken === recoveryAttempt.current) setRecoveryMessage("Couldn’t process this photo. Retake and try again."); }
    finally { if (recoveryToken === recoveryAttempt.current) setRecoveryBusy(false); }
  }, [capture, recoveryBusy, recoveryCamera, recoveryCameraReady, stopStream]);
  function upload(file: File | undefined) {
    if (!file || uploadBusy) return;
    session.current += 1;
    stillnessFingerprint.current = null;
    qualitySkipStreak.current = 0; motionSkipStreak.current = 0;
    liveHintStreak.current = { reason: null, count: 0 };
    setLiveHint(null);
    stopStream();
    clearResult();
    resetScanMetrics();
    setUploadBusy(true);
    setUploadUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    setState((current) => transitionScannerLifecycle(current, current === "camera_off" ? "START" : "RETRY"));
  }
  useEffect(() => () => { session.current += 1; stillnessFingerprint.current = null; recoveryAttempt.current += 1; scannerMetricsEnabled.current = false; scannerMetrics.current.discard(); stopStream(); }, [stopStream]);
  const resultPresentationKey = state === "results" && groups.length > 0
    ? groups.map(({ detection }) => detection.id).join("|")
    : null;
  const automaticSelectedId = state === "results" && groups.length === 1
    ? groups[0].detection.id
    : null;
  useEffect(() => {
    if (!resultPresentationKey || deferAutoResults) return;
    setSelected(automaticSelectedId);
    setSheet(true);
  }, [automaticSelectedId, deferAutoResults, resultPresentationKey]);
  useEffect(() => setShowCameraDiagnostics(new URLSearchParams(window.location.search).has("cameraDebug")), []);
  useEffect(() => {
    if (!showCameraDiagnostics) { setVideoLayoutProbe(null); return; }
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const videoRect = video.getBoundingClientRect();
      const scene = video.closest(".camera-scene");
      const sceneRect = scene?.getBoundingClientRect();
      const style = window.getComputedStyle(video);
      setVideoLayoutProbe(`video ${Math.round(videoRect.width)}×${Math.round(videoRect.height)} @${Math.round(videoRect.top)} · scene ${sceneRect ? `${Math.round(sceneRect.width)}×${Math.round(sceneRect.height)}` : "n/a"} · fit:${style.objectFit} · css:${style.width}×${style.height} · vw:${video.videoWidth}×${video.videoHeight}`);
    }, 500);
    return () => window.clearInterval(timer);
  }, [showCameraDiagnostics]);
  useEffect(() => { if (state !== "captured_analyzing") { setAnalysisPhase("identifying"); return; } setAnalysisPhase("identifying"); const toCatalog = window.setTimeout(() => setAnalysisPhase("catalog"), 1500); const toSlow = window.setTimeout(() => setAnalysisPhase("slow"), 7000); return () => { window.clearTimeout(toCatalog); window.clearTimeout(toSlow); }; }, [state]);
  useEffect(() => { if (!shouldRunScannerScheduler(state) || sheet || uploadUrl || recoveryCamera) return; const timer = window.setInterval(() => {
    const video = videoRef.current;
    if (!video?.readyState || inFlight.current) return;
    const sample = sampleLiveFrame(video);
    if (!sample) { qualitySkipStreak.current = 0; motionSkipStreak.current = 0; noteLiveHint(null); void preflight(video); return; }
    const quality = clientFrameQualityEnabled ? sampleFrameQuality(sample.data, 16, 12) : null;
    const decision = decideLiveFrameSchedulerTick({
      previous: stillnessFingerprint.current,
      current: sample.luma,
      quality,
      qualityEnabled: clientFrameQualityEnabled,
      qualitySkipStreak: qualitySkipStreak.current,
      motionSkipStreak: motionSkipStreak.current,
    });
    stillnessFingerprint.current = decision.baseline;
    qualitySkipStreak.current = decision.qualitySkipStreak;
    motionSkipStreak.current = decision.motionSkipStreak;
    if (decision.action === "motion_skip") { scannerMetrics.current.recordMotionSkip(); noteLiveHint("motion"); return; }
    if (decision.qualitySkipped) scannerMetrics.current.recordQualitySkip();
    if (decision.action === "quality_skip") { noteLiveHint(quality?.tooBlurry ? "blur" : quality?.tooDark ? "dark" : "glare"); return; }
    noteLiveHint(null);
    void preflight(video);
  }, FRAME_INTERVAL); return () => window.clearInterval(timer); }, [noteLiveHint, preflight, recoveryCamera, sampleLiveFrame, sheet, state, uploadUrl]);
  useEffect(() => {
    if (!uploadUrl || !shouldRunScannerScheduler(state) || sheet) return;
    const image = new Image();
    let cancelled = false;
    // A gallery selection is already an intentional still capture. Sending it
    // through the live-camera preflight adds an unnecessary short timeout and
    // can reject complex shelf photos before the full analysis even begins.
    image.onload = () => { if (!cancelled) { scannerMetrics.current.markCaptureReady(); void analyze(image, session.current); } };
    image.onerror = () => {
      if (cancelled) return;
      setUploadBusy(false);
      setFailure("Couldn’t open this photo");
      dispatch("ANALYZE_FAILURE");
    };
    image.src = uploadUrl;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, [analyze, dispatch, sheet, state, uploadUrl]);
  const failed = state === "no_scene" || state === "error";
  const showAnalysisSpinner = state === "captured_analyzing" || (uploadUrl !== null && uploadBusy && state === "live_searching");
  const recoveryActive = recoveryCamera !== null;

  return <main className="scanner-shell"><section className={`camera-scene ${state === "camera_off" ? "idle" : ""} ${recoveryActive ? "recovery-active" : ""}`} aria-label={recoveryActive ? "Recovery camera" : "Sugar product scanner"}>
    {uploadUrl ? <img ref={uploadPreviewRef} className="camera-preview" src={uploadUrl} alt="Selected products" /> : <video key={cameraKey} ref={videoRef} className="camera-preview" muted playsInline />}{frozen && !recoveryActive && <img className="camera-preview frozen-preview" src={frozen} alt="Captured products" />}{state !== "camera_off" && <div className="camera-vignette" />}
    {!recoveryActive && <><header className={`camera-controls ${state === "live_searching" && torchAvailable ? "" : "end"}`}><div>{state === "live_searching" && torchAvailable ? <button className={`round-control torch-control ${torchOn ? "active" : ""}`} onClick={() => void toggleTorch()} aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"} aria-pressed={torchOn}><TorchIcon /></button> : null}</div><button className={`round-control ${state === "camera_off" ? "flat" : ""}`} onClick={close} aria-label="Close camera"><CloseIcon /></button></header>
    {state === "live_searching" && liveHint && <p className="live-hint" aria-live="polite">{liveHint}</p>}
    {groups.map((group) => <ProductOverlay key={group.detection.id} group={group} selected={selected === group.detection.id} onSelect={() => { setSelected(group.detection.id); setSheet(true); }} />)}
    {showAnalysisSpinner && <span className="scan-spinner" aria-label="Checking product details" />}
    {state === "camera_off" && <ScannerHome onStart={() => void start()} />}{failed && <Prompt title={failure ?? "Couldn’t scan this scene"} action="Try again" onAction={retry} failure />}
    {state === "captured_analyzing" && <CameraCopy>{analysisPhase === "identifying" ? "Calculating your Sugar Fit" : analysisPhase === "catalog" ? "Personalizing your result" : "Still working on your result"}</CameraCopy>}
    {state !== "camera_off" && state !== "captured_analyzing" && state !== "results" ? <label className={`gallery-button ${uploadBusy ? "busy" : ""}`} aria-label="Choose a product photo" aria-disabled={uploadBusy}><input type="file" accept="image/*" disabled={uploadBusy} onChange={(e) => { upload(e.target.files?.[0]); e.currentTarget.value = ""; }} /><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM7 15l3-3 2.5 2.5 2-2 2.5 2.5M8 9h.01" /></svg></label> : null}
    {showCameraDiagnostics && cameraDiagnostics ? <CameraDiagnostics snapshot={cameraDiagnostics} layoutProbe={videoLayoutProbe} /> : null}</>}
    {recoveryCamera && <RecoveryCamera key={`${recoveryCamera.id}-${recoveryCamera.mode}`} mode={recoveryCamera.mode} gtin={recovery?.barcode ?? null} allowLabel={recovery?.id === recoveryCamera.id && recovery.state === "barcode_not_found"} busy={recoveryBusy} cameraReady={recoveryCameraReady} message={recoveryMessage} draft={labelDraft} onCapture={() => void captureRecovery()} onModeChange={(mode) => { recoveryAttempt.current += 1; setRecoveryBusy(false); setRecoveryCamera((current) => current ? { ...current, mode } : current); setLabelDraft(null); setRecoveryMessage(null); }} onRetake={() => { recoveryAttempt.current += 1; setRecoveryBusy(false); setLabelDraft(null); setRecoveryMessage(null); }} onRestartCamera={() => startRecovery(recoveryCamera.id, recoveryCamera.mode)} onClose={() => { recoveryAttempt.current += 1; setRecoveryBusy(false); setRecoveryCameraReady(false); setRecoveryCamera(null); stopStream(); setRecoveryMessage(null); }} onSubmitted={(draft) => { const score = createSugarScore(draft.sugarPer100g, "nutrition_label"); setScan((current) => current ? { ...current, detections: current.detections.map((detection) => detection.id === recoveryCamera.id ? { ...detection, status: "estimate", visualCandidate: { brand: draft.brand ?? detection.visualCandidate.brand, name: draft.name ?? detection.visualCandidate.name, packSize: draft.packSize ?? detection.visualCandidate.packSize, gtin: recovery?.barcode ?? detection.visualCandidate.gtin }, product: { id: detection.product?.id ?? `demo-label-${detection.id}`, gtin: recovery?.barcode ?? null, brand: draft.brand ?? detection.visualCandidate.brand, name: draft.name ?? detection.visualCandidate.name ?? "Unidentified product", packSize: draft.packSize, imageUrl: null, energyKcalPer100g: draft.energyKcal, proteinPer100g: draft.proteinPer100g, fatPer100g: draft.fatPer100g, carbohydratesPer100g: draft.carbohydratesPer100g, score }, score, estimateReason: "Provisional nutrition-label draft — pending curator review." } : detection) } : current); recoveryAttempt.current += 1; setRecoveryBusy(false); setRecoveryCameraReady(false); setRecoveryCamera(null); stopStream(); setRecoveryMessage(null); setRecoverySubmissionBanner("Submitted for curator review. This demo result is provisional and has not changed the confirmed catalog."); setSheet(true); setSelected(recoveryCamera.id); }} onDraftChange={setLabelDraft} />}
  </section>{state === "results" && !sheet && !recoveryActive && <SugarFitResultHandle groups={rankedGroups} frozenImage={frozen} onOpen={() => { setSelected(rankedGroups.length === 1 ? rankedGroups[0]?.detection.id ?? null : null); setSheet(true); }} />}{sheet && !recoveryActive && <SugarFitResultsSheet groups={rankedGroups} frozenImage={frozen} selectedId={selected} recoveryBanner={recoverySubmissionBanner} onSelect={setSelected} onClose={() => { setSheet(false); setSelected(null); }} onScanAgain={() => void start()} />}<canvas ref={canvasRef} className="hidden-canvas" /></main>;
}

function RecoveryCamera({ mode, gtin, allowLabel, busy, cameraReady, message, draft, onCapture, onModeChange, onRetake, onRestartCamera, onClose, onSubmitted, onDraftChange }: { mode: "package" | "label"; gtin: string | null; allowLabel: boolean; busy: boolean; cameraReady: boolean; message: string | null; draft: NutritionLabelDraft | null; onCapture: () => void; onModeChange: (mode: "package" | "label") => void; onRetake: () => void; onRestartCamera: () => void; onClose: () => void; onSubmitted: (draft: NutritionLabelDraft) => void; onDraftChange: (draft: NutritionLabelDraft | null) => void }) {
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "duplicate" | "error">("idle"), [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null), [hasAttempt, setHasAttempt] = useState(false);
  const update = (key: keyof NutritionLabelDraft, value: string) => { if (!draft) return; const numeric = ["energyKcal", "proteinPer100g", "fatPer100g", "carbohydratesPer100g", "sugarPer100g"].includes(key); onDraftChange({ ...draft, [key]: numeric ? (value === "" ? null : Number(value)) : value }); };
  const submit = async () => {
    if (!draft || submitState === "saving") return;
    setSubmitState("saving"); setSubmitErrorMessage(null);
    try {
      const response = await fetch("/api/catalog/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gtin, brand: draft.brand ?? "Unknown", name: draft.name ?? "Unidentified product", packSize: draft.packSize, energyKcal: draft.energyKcal, proteinPer100g: draft.proteinPer100g, fatPer100g: draft.fatPer100g, carbohydratesPer100g: draft.carbohydratesPer100g, sugarPer100g: draft.sugarPer100g, labelSeenLocally: true, intakeProvenance: "gemini_label", labelCaptureConsented: true, nutritionFieldConfidence: { energyKcal: draft.fieldConfidence.energyKcal, proteinPer100g: draft.fieldConfidence.proteinPer100g, fatPer100g: draft.fieldConfidence.fatPer100g, carbohydratesPer100g: draft.fieldConfidence.carbohydratesPer100g, sugarPer100g: draft.fieldConfidence.sugarPer100g } }) });
      const outcome = catalogProposalSubmissionOutcome(response.status);
      if (outcome === "saved") { onSubmitted(draft); return; }
      if (outcome === "duplicate") { setSubmitState("duplicate"); return; }
      setSubmitErrorMessage(await catalogProposalErrorMessage(response));
      setSubmitState("error");
    } catch {
      setSubmitErrorMessage(GENERIC_PROPOSAL_ERROR_MESSAGE);
      setSubmitState("error");
    }
  };
  const cameraProblem = !cameraReady && message?.startsWith("Camera unavailable");
  return <div className="recovery-camera" role="dialog" aria-modal="true" aria-label="Recovery camera"><div className="recovery-camera-shade"><button className="round-control" onClick={onClose} aria-label="Close recovery"><CloseIcon /></button><div className="recovery-camera-copy"><strong>{mode === "package" ? "Photograph the package barcode" : "Photograph Nutrition Facts"}</strong><span>{mode === "package" ? "One still photo. Nothing is analysed continuously." : "One consented Gemini request after you tap Take photo."}</span></div>{!draft && <button className="recovery-take" disabled={busy || !cameraReady} onClick={() => { setHasAttempt(true); onCapture(); }}>{busy ? "Reading…" : !cameraReady ? "Starting camera…" : hasAttempt ? "Retake" : "Take photo"}</button>}{cameraProblem && <button className="recovery-secondary" onClick={onRestartCamera}>Try camera again</button>}{mode === "package" && allowLabel && !draft && !cameraProblem && <button className="recovery-secondary" disabled={busy || !cameraReady} onClick={() => onModeChange("label")}>Take nutrition-label photo</button>}{message && <p className="recovery-status" aria-live="polite">{message}</p>}{draft && <div className="recovery-draft"><strong>Review draft — provisional, pending curator review</strong>{(["brand", "name", "packSize", "energyKcal", "proteinPer100g", "fatPer100g", "carbohydratesPer100g", "sugarPer100g"] as (keyof NutritionLabelDraft)[]).map((key) => <label key={key}>{key}<input disabled={submitState === "saving"} value={typeof draft[key] === "object" ? "" : String(draft[key] ?? "")} onChange={(event) => update(key, event.target.value)} /></label>)}{submitState === "error" && <p className="recovery-submit-error" role="alert">{submitErrorMessage ?? GENERIC_PROPOSAL_ERROR_MESSAGE}</p>}{submitState === "duplicate" && <p className="barcode-recovery-note" role="status">This item is already waiting for curator review.</p>}<div className="recovery-draft-actions recovery-draft-submit">{submitState === "duplicate" ? <button onClick={onClose}>Close</button> : <><button disabled={submitState === "saving"} onClick={onRetake}>Retake</button><button disabled={submitState === "saving"} onClick={() => void submit()}>{submitState === "saving" ? "Submitting…" : "OK — submit for review"}</button></>}</div></div>}</div></div>;
}

function SugarNoWordmark() {
  return <svg className="scanner-home-logo" viewBox="0 0 103 20" aria-hidden="true">
    <path d="M96.3079 15.3691C92.7922 15.3691 90.1816 12.9902 90.1816 9.4323C90.1816 5.89548 92.8132 3.5376 96.3079 3.5376C99.7816 3.5376 102.413 5.91653 102.413 9.4323C102.413 12.9902 99.8237 15.3691 96.3079 15.3691ZM96.3079 13.0112C98.35 13.0112 99.3395 11.306 99.3395 9.4323C99.3395 7.57968 98.329 5.89548 96.3079 5.89548C94.2658 5.89548 93.2553 7.55862 93.2553 9.4323C93.2553 11.306 94.2658 13.0112 96.3079 13.0112Z" fill="currentColor" />
    <path d="M77.96 15.0736V9.19997C77.96 6.98946 78.5494 3.72632 83.4757 3.72632C88.381 3.72632 88.9705 6.98946 88.9705 9.19997V15.0736H85.8968V9.22102C85.8968 7.49471 85.4968 6.06315 83.4757 6.06315C81.4547 6.06315 81.0336 7.47366 81.0336 9.22102V15.0736H77.96Z" fill="currentColor" />
    <path d="M68.832 15.0737V9.20006C68.832 4.75798 71.1478 3.87378 74.3057 3.87378C75.0215 3.87378 75.7794 3.91588 76.5794 3.97904V6.18955C75.8215 6.14745 75.1057 6.06324 74.4952 6.06324C72.9162 6.06324 71.8847 6.54745 71.8847 9.22111V15.1158L68.832 15.0737Z" fill="currentColor" />
    <path d="M64.0624 15.0739V13.6844C63.3466 14.8002 62.1676 15.2844 60.8624 15.3686C57.4098 15.6002 55.0098 12.8845 55.0098 9.47395C55.0098 5.97924 57.7255 3.70557 61.1361 3.70557C64.0834 3.70557 67.1361 5.83187 67.1361 8.98974V15.0739H64.0624ZM61.0098 13.0318C62.8624 13.0318 64.0413 11.2424 64.0413 9.51605C64.0413 7.68449 62.9676 6.14766 61.0098 6.14766C59.115 6.14766 58.1045 7.70554 58.1045 9.4529C58.1045 11.1792 59.0729 13.0318 61.0098 13.0318Z" fill="currentColor" />
    <path d="M42.2248 18.1055L44.5617 16.5476C45.5932 17.4318 46.1196 17.6423 47.488 17.6423C49.1301 17.6423 50.288 16.3792 50.288 14.7581V14.316C49.3616 15.0318 48.2459 15.3686 47.088 15.3686C43.6353 15.3686 41.2354 12.8845 41.2354 9.47395C41.2354 6.00029 43.9722 3.70557 47.3617 3.70557C50.309 3.70557 53.3616 5.83187 53.3616 8.98974V14.8423C53.3616 18.0213 50.3932 20.0002 47.4248 20.0002C45.509 20.0002 43.5722 19.5581 42.2248 18.1055ZM47.2353 13.0318C49.088 13.0318 50.2669 11.2424 50.2669 9.51605C50.2669 7.68449 49.1932 6.14766 47.2353 6.14766C45.3406 6.14766 44.3301 7.70554 44.3301 9.4529C44.3301 11.1792 45.2985 13.0318 47.2353 13.0318Z" fill="currentColor" />
    <path d="M28.8037 3.97949H31.8774V9.87419C31.8774 11.6215 32.2984 13.011 34.3195 13.011C36.3405 13.011 36.7405 11.6005 36.7405 9.87419V3.97949L39.8142 4.0216V9.89524C39.8142 12.1058 39.2247 15.3689 34.3195 15.3689C29.3932 15.3689 28.8037 12.1058 28.8037 9.89524V3.97949Z" fill="currentColor" />
    <path d="M16.8057 13.4948L19.0162 11.8106C19.9214 12.6527 20.5741 12.9685 21.9425 12.9685C22.4688 12.9685 23.9214 12.8633 23.7109 11.979C23.353 11.0527 21.6899 10.9264 20.8688 10.7369C18.8478 10.2527 16.8267 9.32643 16.8267 6.9475C16.8267 4.8633 19.0162 3.5791 21.7951 3.5791C24.2162 3.5791 26.153 4.54752 26.8477 6.18961L24.1741 7.17908C23.732 6.35803 22.8688 5.91593 21.6267 5.91593C20.5951 5.91593 19.9636 6.29487 19.9636 6.9054C19.9636 8.27381 22.3004 8.50538 23.2688 8.75801C25.0162 9.17906 26.9741 9.85274 26.9741 12.1054C26.9741 14.2527 24.532 15.4106 21.8372 15.4106C19.6057 15.4106 18.0267 14.7369 16.8057 13.4948Z" fill="currentColor" />
    <path d="M1.22105 15.0736L2.08421 11.0947H0L0.73684 8.84205H2.56841L3.15789 6.06312H0.631577L1.36842 3.8105H3.66315L4.50525 0H7.47367L6.63156 3.8105H9.51577L10.3579 0H13.3263L12.4842 3.8105H14.6736L13.9579 6.06312H11.9789L11.3684 8.84205H13.8737L13.1368 11.0947H10.8842L9.99998 15.0736H7.03156L7.91577 11.0947H5.03157L4.16841 15.0736H1.22105ZM5.53683 8.84205H8.42103L9.0105 6.06312H6.1263L5.53683 8.84205Z" fill="currentColor" />
  </svg>;
}

function ScannerHome({ onStart }: { onStart: () => void }) {
  return <div className="scanner-home">
    <div className="scanner-home-visual">
      <div className="scanner-home-orbit">
        <div className="scanner-home-brand-card" aria-label="#sugarno">
          <SugarNoWordmark />
          <span className="scanner-home-wave" aria-hidden="true" />
        </div>
      </div>
    </div>
    <div className="scanner-home-copy">
      <h1>See the shelf differently.</h1>
      <p>Point. Scan. Know what fits.</p>
      <button className="scanner-home-primary" type="button" onClick={onStart}>Start scanning</button>
    </div>
  </div>;
}

function Prompt({ title, action, onAction, failure = false }: { title: string; action: string; onAction: () => void; failure?: boolean }) {
  const [heading, ...rest] = title.split("\n");
  const description = rest.join(" ") || null;
  return <div className={`scanner-prompt ${failure ? "failure" : ""}`} role={failure ? "status" : undefined}><strong>{heading}</strong>{description && <p>{description}</p>}<button onClick={onAction}>{action}</button></div>;
}
function CameraCopy({ children }: { children: React.ReactNode }) { return <div className="camera-copy" aria-live="polite"><span className="camera-copy-indicator" aria-hidden="true"><i /></span><span className="camera-copy-text"><strong>{children}</strong><small>Your photo is sent for analysis and isn’t saved.</small></span><span className="camera-copy-progress" aria-hidden="true"><i /></span></div>; }
function CameraDiagnostics({ snapshot, layoutProbe }: { snapshot: CameraDiagnosticSnapshot; layoutProbe: string | null }) { const { settings, capabilities, source, imageCapture } = snapshot; return <aside className="camera-diagnostics" aria-label="Local camera diagnostics"><strong>Camera diagnostics</strong><span>{source.sessionId ?? "camera unavailable"} · {settings.width ?? "?"}×{settings.height ?? "?"} · {settings.frameRate ?? "?"} fps</span><span>{settings.facingMode ?? "unknown"} · zoom {settings.zoom ?? "n/a"}{capabilities.zoom ? ` (${capabilities.zoom.min ?? "?"}–${capabilities.zoom.max ?? "?"})` : ""}</span><span>ImageCapture {imageCapture.takePhoto ? "takePhoto available" : "not available"}</span>{layoutProbe && <span>{layoutProbe}</span>}</aside>; }
function ProductOverlay({ group, selected, onSelect }: { group: DetectionGroup; selected: boolean; onSelect: () => void }) { const { detection, box, count } = group; const fit = calculateSugarFit({ sugarPer100g: detection.score.sugarPer100g, packSize: detection.product?.packSize ?? detection.visualCandidate.packSize, brand: detection.product?.brand ?? detection.visualCandidate.brand, name: detection.visualCandidate.name ?? detection.product?.name }); const label = fit ? `${fit.score} for you` : "Check"; const labelInside = box.y < .14; return <button className={`product-overlay ${fit?.tone ?? "unknown"} ${labelInside ? "label-inside" : ""} ${selected ? "selected" : ""}`} onClick={onSelect} aria-expanded={selected} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><span className="overlay-label">{label}</span>{count > 1 && <span className="repeat-chip">×{count}</span>}{selected && <span className="overlay-check"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg></span>}</button>; }
function ResultsSheet({ groups, selectedId, recovery, recoveryBanner, onRecover, onSelect, onClose }: { groups: DetectionGroup[]; selectedId: string | null; recovery: RecoveryInfo | null; recoveryBanner: string | null; onRecover: (id: string, mode?: "package" | "label") => void; onSelect: (id: string | null) => void; onClose: () => void }) { return <section className="result-sheet" aria-label="Recognized products"><div className="sheet-header"><button className="sheet-grabber" onClick={onClose} aria-label="Close details" /><span>{groups.length} products found</span><button onClick={onClose} aria-label="Close product list"><CloseIcon /></button></div>{recoveryBanner && <p className="recovery-submission-banner" role="status">{recoveryBanner}</p>}<p className="sheet-intro">Tap a product to see its sugar impact.</p><div className="product-list">{groups.map(({ detection, count }) => { const open = selectedId === detection.id, hasSugar = detection.score.sugarPer100g !== null, title = [detection.visualCandidate.brand, detection.visualCandidate.name].filter(Boolean).join(" · "), source = detection.product?.provenance, recoveryForProduct = recovery?.id === detection.id ? recovery : null; return <article key={detection.id} className={`product-row ${open ? "open" : ""}`}><button className="product-summary" onClick={() => onSelect(open ? null : detection.id)}><span className={`score-orb ${hasSugar ? detection.score.band : "unknown"}`}><svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10" /></svg></span><span className="product-name"><strong>{title || "Unidentified product"}</strong><span className={`status-tag ${detection.status === "confirmed" ? "confirmed" : detection.status === "estimate" ? "estimate" : "unconfirmed"}`}>{detection.status === "confirmed" ? "Confirmed" : detection.status === "estimate" ? "AI estimate" : "Needs confirmation"}</span></span>{count > 1 && <span className="repeat-count">×{count}</span>}<span className="sugar-value">{displaySugar(detection.score.sugarPer100g)}{hasSugar && "g"}<small>/100g</small></span><Chevron up={open} /></button>{open && <div className="product-details"><div className="sugar-meter"><div className="sugar-meter-label"><span>Sugar level</span><strong>{hasSugar ? bandCopy[detection.score.band] : "Not confirmed"}</strong></div>{hasSugar && meterPosition[detection.score.band] && <div className="sugar-meter-track"><span className="sugar-meter-marker" style={{ left: meterPosition[detection.score.band] as string }} /></div>}</div>{count > 1 && <div><span>In this scan</span><strong>{count} matching products</strong></div>}<div className="nutrition-facts"><div className="nutrition-facts-label"><span>Nutrition facts</span><span>Per 100g</span></div><div className="nutrition-facts-grid"><div className="nutrition-fact"><span>Energy</span><strong className={detection.product?.energyKcalPer100g == null ? "unconfirmed" : ""}>{detection.product?.energyKcalPer100g != null ? `${Math.round(detection.product.energyKcalPer100g)} kcal` : "Not confirmed"}</strong></div><div className="nutrition-fact"><span>Protein</span><strong className={detection.product?.proteinPer100g == null ? "unconfirmed" : ""}>{detection.product?.proteinPer100g != null ? `${displaySugar(detection.product.proteinPer100g)}g` : "Not confirmed"}</strong></div><div className="nutrition-fact"><span>Fat</span><strong className={detection.product?.fatPer100g == null ? "unconfirmed" : ""}>{detection.product?.fatPer100g != null ? `${displaySugar(detection.product.fatPer100g)}g` : "Not confirmed"}</strong></div><div className="nutrition-fact"><span>Carbs</span><strong className={detection.product?.carbohydratesPer100g == null ? "unconfirmed" : ""}>{detection.product?.carbohydratesPer100g != null ? `${displaySugar(detection.product.carbohydratesPer100g)}g` : "Not confirmed"}</strong></div></div></div><div><span>Source</span><strong>{source ? sourceCopy[source.source] : detection.status === "estimate" ? "AI estimate" : "Not confirmed"}</strong></div>{detection.estimateReason && <p>{detection.estimateReason}</p>}{shouldOfferBarcodeRecovery(detection.status, open) && <RecoveryCard recovery={recoveryForProduct} candidate={detection.visualCandidate} onStart={() => onRecover(detection.id)} onLabel={() => onRecover(detection.id, "label")} />}</div>}</article>; })}</div></section>; }

function RecoveryCard({ recovery, candidate, onStart, onLabel }: { recovery: RecoveryInfo | null; candidate: Detection["visualCandidate"]; onStart: () => void; onLabel: () => void }) { const message = recovery?.state === "searching" ? "Take one package photo; the barcode is checked on this device." : recovery?.state === "barcode_found" ? "Barcode found — checking the catalog…" : recovery?.state === "barcode_not_found" ? "Barcode not recognised or not in the confirmed catalog." : "Turn the package to its barcode or nutrition label."; return <div className="barcode-recovery-card"><strong>Need a confirmed result?</strong><p>{message}</p>{recovery?.state === "barcode_not_found" && <button className="recovery-card-action" onClick={onLabel}>Take nutrition-label photo</button>}{recovery?.state === "barcode_not_found" && recovery.barcode ? <CatalogProposalForm barcode={recovery.barcode} candidate={candidate} labelSeenLocally={false} /> : null}{!recovery && <button className="recovery-card-action" onClick={onStart}>Continue with package</button>}</div>; }

function CatalogProposalForm({ barcode, candidate, labelSeenLocally }: { barcode: string; candidate: Detection["visualCandidate"]; labelSeenLocally: boolean }) { const [brand, setBrand] = useState(candidate.brand ?? ""), [name, setName] = useState(candidate.name ?? ""), [packSize, setPackSize] = useState(candidate.packSize ?? ""), [sugar, setSugar] = useState(""), [protein, setProtein] = useState(""), [status, setStatus] = useState<"idle" | "saving" | "saved" | "duplicate" | "error">("idle"); const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setStatus("saving"); const numberOrNull = (value: string) => value.trim() === "" ? null : Number(value); try { const response = await fetch("/api/catalog/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gtin: barcode, brand, name, packSize: packSize.trim() || null, sugarPer100g: numberOrNull(sugar), proteinPer100g: numberOrNull(protein), labelSeenLocally }) }); setStatus(catalogProposalSubmissionOutcome(response.status)); } catch { setStatus("error"); } }; if (status === "saved") return <p className="barcode-recovery-note">Suggestion sent for review. It will not change results until a curator verifies it.</p>; if (status === "duplicate") return <p className="barcode-recovery-note">This barcode is already waiting for curator review.</p>; return <form className="catalog-proposal-form" onSubmit={submit}><strong>Suggest this product</strong><p>Enter only what is printed on the package. Your photo and label text stay on this device.</p><label>Brand<input required maxLength={120} value={brand} onChange={(event) => setBrand(event.target.value)} /></label><label>Product name<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Pack size<input maxLength={40} placeholder="e.g. 330 ml" value={packSize} onChange={(event) => setPackSize(event.target.value)} /></label><div className="catalog-proposal-nutrition"><label>Sugar / 100g<input inputMode="decimal" min="0" max="100" type="number" step="0.1" value={sugar} onChange={(event) => setSugar(event.target.value)} /></label><label>Protein / 100g<input inputMode="decimal" min="0" max="100" type="number" step="0.1" value={protein} onChange={(event) => setProtein(event.target.value)} /></label></div>{status === "error" && <p className="catalog-proposal-error">Couldn’t send this suggestion. Check the fields and try again.</p>}<button className="recovery-card-action" disabled={status === "saving"}>{status === "saving" ? "Sending…" : "Send for review"}</button></form>; }
