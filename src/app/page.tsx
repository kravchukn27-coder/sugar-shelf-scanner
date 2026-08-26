"use client";

import "./barcode-recovery.css";

import { useCallback, useEffect, useRef, useState } from "react";
import OnboardingStory from "./onboarding-story";
import lensStyles from "./camera-lens.module.css";
import type { AnalyzeScanResponse, Detection, PreflightScanResponse } from "@/lib/contracts/scan";
import { formatSugarPer100g } from "@/lib/scoring/format-sugar";
import { createSugarScore } from "@/lib/scoring/sugar-score";
import { groupRepeatedDetections, type DetectionGroup } from "@/lib/scan/deduplicate-detections";
import { getCenteredFrameCrop, mapAnalyzedBoxToPreview } from "@/lib/scan/frame-crop";
import { getCameraDiagnosticSnapshot, type CameraDiagnosticSnapshot } from "@/lib/scan/camera-diagnostics";
import { applyCameraView, getCameraControls, getCameraDeviceId, preferCameraCaptureQuality, rearCameraRequest, supportsTorch, type CameraControls } from "@/lib/scan/media-capabilities";
import { shouldRunScannerScheduler, transitionScannerLifecycle, type ScannerLifecycleEvent, type ScannerLifecycleState } from "@/lib/scan/scanner-lifecycle";
import { createScannerMetrics, type ScannerMetricsCompletion } from "@/lib/scan/scanner-metrics";
import { isFrameMoving, sampleLuma } from "@/lib/scan/frame-stillness";
import { sampleFrameQuality, shouldBypassQualityAfterSkips, shouldSkipPreflight } from "@/lib/scan/frame-quality";
import { decodeLocalBarcode, type RecoveryState } from "@/lib/recovery/local-recovery";
import type { BarcodeRecoveryResponse, NutritionLabelDraft, NutritionLabelRecoveryResponse } from "@/lib/contracts/scan";
import { shouldOfferBarcodeRecovery } from "@/lib/recovery/recovery-ui";
import { catalogProposalSubmissionOutcome } from "@/lib/recovery/catalog-proposal-ui";

const FRAME_INTERVAL = 650;
const PREFLIGHT_CANDIDATE_CONFIDENCE_THRESHOLD = 0.65;
const clientScannerMetricsEnabled = process.env.NEXT_PUBLIC_SCANNER_METRICS_ENABLED === "true";
// Default-on for live camera; set NEXT_PUBLIC_FRAME_QUALITY_ENABLED=false for fast rollback.
const clientFrameQualityEnabled = process.env.NEXT_PUBLIC_FRAME_QUALITY_ENABLED !== "false";
const bandCopy = { green: "Low sugar", yellow: "Moderate sugar", orange: "High sugar", red: "Very high sugar", unknown: "Needs a check" } as const;
const sourceCopy = { curated: "Sugar catalog", open_food_facts: "Open Food Facts", usda_food_data_central: "USDA FoodData Central", commercial: "Verified provider" } as const;
const meterPosition = { green: "12.5%", yellow: "37.5%", orange: "62.5%", red: "87.5%", unknown: null } as const;
const eligible = (d: Detection) => d.confidence >= .55 && Boolean(d.visualCandidate.brand || d.visualCandidate.name);
const displaySugar = (value: number | null | undefined) => formatSugarPer100g(value) ?? "—";
function Chevron({ up = false }: { up?: boolean }) { return <svg aria-hidden="true" className={up ? "chevron up" : "chevron"} viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>; }
function TorchIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6l-1 6h3l-7 12 1-8H8z" /></svg>; }
function ZoomInIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5" /><path d="M10.5 7.5v6M7.5 10.5h6M15 15l4 4" /></svg>; }
function BarcodeIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14M12 5v14" /></svg>; }
type RecoveryInfo = { id: string; state: RecoveryState; labelSeen: boolean; barcode: string | null };

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null), uploadPreviewRef = useRef<HTMLImageElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), streamRef = useRef<MediaStream | null>(null), abortRef = useRef<AbortController | null>(null), inFlight = useRef(false), session = useRef(0), frame = useRef(0), recoveryAttempt = useRef(0), preferredCameraDeviceId = useRef<string | null>(null), scannerMetrics = useRef(createScannerMetrics()), scannerMetricsEnabled = useRef(false), stillnessFingerprint = useRef<Uint8ClampedArray | null>(null), stillnessCanvas = useRef<HTMLCanvasElement | null>(null), qualitySkipStreak = useRef(0);
  const [state, setState] = useState<ScannerLifecycleState>("camera_off");
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
  const [sheet, setSheet] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false), [torchOn, setTorchOn] = useState(false);
  const [cameraControls, setCameraControls] = useState<CameraControls>({ torchAvailable: false, standardZoom: null, closerZoom: null });
  const [closerViewOn, setCloserViewOn] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null);
  const [recoveryCamera, setRecoveryCamera] = useState<{ id: string; mode: "package" | "label" } | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryCameraReady, setRecoveryCameraReady] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [recoverySubmissionBanner, setRecoverySubmissionBanner] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<NutritionLabelDraft | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const [analysisPhase, setAnalysisPhase] = useState<"identifying" | "catalog" | "slow">("identifying");
  const [liveHint, setLiveHint] = useState<string | null>(null);
  const groups = groupRepeatedDetections((scan?.detections ?? []).filter(eligible));
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
  const stopStream = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; inFlight.current = false; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setTorchOn(false); setTorchAvailable(false); setCameraDiagnostics(null); setCameraControls({ torchAvailable: false, standardZoom: null, closerZoom: null }); setCloserViewOn(false); if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; } }, []);
  const clearResult = useCallback(() => { setRecovery(null); setRecoveryCamera(null); setRecoveryBusy(false); setRecoveryMessage(null); setRecoverySubmissionBanner(null); setLabelDraft(null); setScan(null); setFrozen(null); setFailure(null); setSheet(false); setSelected(null); setUploadBusy(false); setLiveHint(null); }, []);

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

  const analyze = useCallback(async (source: HTMLVideoElement | HTMLImageElement, id: number) => {
    // Keep the live camera at its standard field of view. Once preflight has
    // positively identified a product, this modest centred crop gives Gemini
    // a closer frozen frame without selecting a different physical lens.
    const encodeStartedAt = performance.now();
    const image = capture(source, 960, .7, 1.12); scannerMetrics.current.recordCaptureEncode(encodeStartedAt); if (!image || id !== session.current) return;
    if (source instanceof HTMLVideoElement) setFrozen(image);
    dispatch("CAPTURED");
    const controller = new AbortController(); abortRef.current = controller;
    const requestStartedAt = scannerMetrics.current.startRequest("analyze");
    let requestTimingFinished = false;
    const finishRequestTiming = () => { if (!requestTimingFinished) { scannerMetrics.current.finishRequest("analyze", requestStartedAt); requestTimingFinished = true; } };
    try {
      const response = await fetch("/api/scan/analyze", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", context: "shelf", clientFrameId: `frame-${++frame.current}` }) });
      finishRequestTiming(); noteMetricsCapability(response);
      if (id !== session.current) return;
      if (!response.ok) { setFailure("Couldn’t analyze this capture"); dispatch("ANALYZE_FAILURE"); completeScanMetrics(id, "request_failure"); return; }
      const result = await response.json() as AnalyzeScanResponse;
      if (id !== session.current) return;
      const preview = source instanceof HTMLImageElement ? uploadPreviewRef.current?.getBoundingClientRect() : null;
      const sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.videoWidth;
      const sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.videoHeight;
      const analyzedCrop = preview ? getCenteredFrameCrop(sourceWidth, sourceHeight, preview.width, preview.height, 1.12) : null;
      const displayResult = source instanceof HTMLImageElement && preview && analyzedCrop
        ? { ...result, detections: result.detections.map((detection) => ({ ...detection, box: mapAnalyzedBoxToPreview(detection.box, analyzedCrop, { width: sourceWidth, height: sourceHeight }, { width: preview.width, height: preview.height }) ?? detection.box })) }
        : result;
      if (displayResult.detections.some(eligible)) { setScan(displayResult); dispatch("ANALYZE_SUCCESS"); } else { setFailure("No recognizable packaged products found"); dispatch("NO_SCENE"); }
      completeScanMetrics(id, "analysis_completed");
    } catch (error) { finishRequestTiming(); if (id === session.current && !(error instanceof DOMException && error.name === "AbortError")) { setFailure("Couldn’t analyze this frame"); dispatch("ANALYZE_FAILURE"); completeScanMetrics(id, "request_failure"); } }
    finally {
      if (id === session.current && source instanceof HTMLImageElement) setUploadBusy(false);
      if (id === session.current && abortRef.current === controller) { inFlight.current = false; abortRef.current = null; }
    }
  }, [capture, completeScanMetrics, dispatch, noteMetricsCapability]);

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
        if (!isUpload && result.decision === "uncertain") { setLiveHint("Move a little closer, or hold steady for a moment…"); return; }
        setLiveHint(null);
        setFailure(result.decision === "uncertain" ? "Move closer to a packaged product" : "No packaged products found — move closer");
        dispatch("NO_SCENE");
        completeScanMetrics(id, "preflight_terminal");
        return;
      }
      setLiveHint(null);
      await analyze(source, id);
    } catch (error) { finishRequestTiming(); if (id === session.current && !(error instanceof DOMException && error.name === "AbortError")) { if (source instanceof HTMLImageElement) setUploadBusy(false); setFailure("Couldn’t check this scene"); dispatch("ANALYZE_FAILURE"); completeScanMetrics(id, "request_failure"); } }
    finally {
      // Full analysis owns its own controller. Do not clear inFlight here once
      // it has begun: that would let an upload/live scheduler start another
      // request or make Close unable to abort the full Gemini request.
      if (id === session.current && abortRef.current === controller) { inFlight.current = false; abortRef.current = null; }
    }
  }, [analyze, capture, completeScanMetrics, dispatch, noteMetricsCapability, sheet, state]);

  const start = useCallback(async () => {
    const id = ++session.current; stillnessFingerprint.current = null; qualitySkipStreak.current = 0; stopStream(); clearResult(); resetScanMetrics(); setUploadUrl(null); setState((current) => transitionScannerLifecycle(current, current === "camera_off" ? "START" : "RETRY"));
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
      setCameraControls(controls); setTorchAvailable(controls.torchAvailable); setCameraDiagnostics(getCameraDiagnosticSnapshot(track)); videoRef.current.srcObject = stream; await videoRef.current.play(); scannerMetrics.current.markCaptureReady();
      if (id !== session.current) { stream.getTracks().forEach((t) => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; streamRef.current = null; }
    }
    catch { if (id === session.current) { setFailure("Camera unavailable. Check permission and try again."); setState((current) => transitionScannerLifecycle(current, "ANALYZE_FAILURE")); } }
  }, [clearResult, resetScanMetrics, stopStream]);
  const close = useCallback(() => { session.current += 1; stillnessFingerprint.current = null; qualitySkipStreak.current = 0; scannerMetricsEnabled.current = false; scannerMetrics.current.discard(); stopStream(); clearResult(); setUploadUrl(null); dispatch("CLOSE_CAMERA"); }, [clearResult, dispatch, stopStream]);
  const toggleTorch = useCallback(async () => { const track = streamRef.current?.getVideoTracks()[0]; const next = !torchOn; if (!track || !supportsTorch(track)) return setTorchAvailable(false); try { await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] }); setTorchOn(next); } catch { setTorchAvailable(false); setTorchOn(false); } }, [torchOn]);
  const toggleCloserView = useCallback(async () => { const track = streamRef.current?.getVideoTracks()[0]; const next = !closerViewOn; try { const applied = await applyCameraView(track, cameraControls, next ? "closer" : "standard"); if (!applied) { setCameraControls((current) => ({ ...current, closerZoom: null })); setCloserViewOn(false); return; } setCloserViewOn(next); setCameraDiagnostics(getCameraDiagnosticSnapshot(track)); } catch { setCameraControls((current) => ({ ...current, closerZoom: null })); setCloserViewOn(false); } }, [cameraControls, closerViewOn]);
  const retry = useCallback(() => { if (!uploadUrl) void start(); else { session.current += 1; stillnessFingerprint.current = null; qualitySkipStreak.current = 0; clearResult(); resetScanMetrics(); setUploadBusy(true); dispatch("RETRY"); } }, [clearResult, dispatch, resetScanMetrics, start, uploadUrl]);
  const startRecovery = useCallback((id: string, mode: "package" | "label" = "package") => {
    session.current += 1;
    stillnessFingerprint.current = null;
    qualitySkipStreak.current = 0;
    const recoverySession = session.current;
    const recoveryToken = ++recoveryAttempt.current;
    scannerMetricsEnabled.current = false; scannerMetrics.current.discard();
    stopStream();
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
      if (camera.mode === "package") {
        const response = await fetch(image); const blob = await response.blob();
        const barcode = await decodeLocalBarcode(blob);
        if (recoveryToken !== recoveryAttempt.current) return;
        if (!barcode) { setRecoveryMessage("Barcode not recognised. Retake or photograph the nutrition label."); setRecovery((current) => current?.id === camera.id ? { ...current, state: "barcode_not_found" } : current); return; }
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
      } else {
        const consented = window.confirm("Send this single nutrition-label photo to Gemini for extraction? It is not stored by this app.");
        if (!consented) { setRecoveryMessage("Capture cancelled. Nothing was sent."); return; }
        const response = await fetch("/api/scan/recovery-label", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", labelCaptureConsented: true }) });
        if (recoveryToken !== recoveryAttempt.current) return;
        const result = await response.json() as NutritionLabelRecoveryResponse;
        if (recoveryToken !== recoveryAttempt.current) return;
        if (!response.ok || result.outcome === "unreadable") { setRecoveryMessage("Nutrition label was not readable. Retake for one new request."); return; }
        setLabelDraft(result.draft); setRecoveryMessage("Review the draft, edit any fields, then submit for curator review.");
      }
    } catch { if (recoveryToken === recoveryAttempt.current) setRecoveryMessage("Couldn’t process this photo. Retake and try again."); }
    finally { if (recoveryToken === recoveryAttempt.current) setRecoveryBusy(false); }
  }, [capture, recoveryBusy, recoveryCamera, recoveryCameraReady, stopStream]);
  function upload(file: File | undefined) {
    if (!file || uploadBusy) return;
    session.current += 1;
    stillnessFingerprint.current = null;
    qualitySkipStreak.current = 0;
    stopStream();
    clearResult();
    resetScanMetrics();
    setUploadBusy(true);
    setUploadUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    setState((current) => transitionScannerLifecycle(current, current === "camera_off" ? "START" : "RETRY"));
  }
  useEffect(() => () => { session.current += 1; stillnessFingerprint.current = null; recoveryAttempt.current += 1; scannerMetricsEnabled.current = false; scannerMetrics.current.discard(); stopStream(); }, [stopStream]);
  useEffect(() => setShowCameraDiagnostics(new URLSearchParams(window.location.search).has("cameraDebug")), []);
  useEffect(() => { if (state !== "captured_analyzing") { setAnalysisPhase("identifying"); return; } setAnalysisPhase("identifying"); const toCatalog = window.setTimeout(() => setAnalysisPhase("catalog"), 1500); const toSlow = window.setTimeout(() => setAnalysisPhase("slow"), 7000); return () => { window.clearTimeout(toCatalog); window.clearTimeout(toSlow); }; }, [state]);
  useEffect(() => { if (!shouldRunScannerScheduler(state) || sheet || uploadUrl || recoveryCamera) return; const timer = window.setInterval(() => {
    const video = videoRef.current;
    if (!video?.readyState || inFlight.current) return;
    const canvas = stillnessCanvas.current ?? (stillnessCanvas.current = document.createElement("canvas"));
    canvas.width = 16; canvas.height = 12;
    const ctx = canvas.getContext("2d");
    if (!ctx) { qualitySkipStreak.current = 0; void preflight(video); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const sample = sampleLuma(ctx, canvas.width, canvas.height);
    const previous = stillnessFingerprint.current;
    // Always advance the baseline to this tick's sample, even when the frame is
    // moving or preflight is skipped, so the next comparison is tick-vs-tick.
    stillnessFingerprint.current = sample;
    if (previous && isFrameMoving(previous, sample)) {
      qualitySkipStreak.current = 0;
      return;
    }
    if (!clientFrameQualityEnabled) {
      qualitySkipStreak.current = 0;
      void preflight(video);
      return;
    }
    const quality = sampleFrameQuality(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (shouldSkipPreflight(quality)) {
      qualitySkipStreak.current += 1;
      scannerMetrics.current.recordQualitySkip();
      if (!shouldBypassQualityAfterSkips(qualitySkipStreak.current)) return;
    }
    qualitySkipStreak.current = 0;
    void preflight(video);
  }, FRAME_INTERVAL); return () => window.clearInterval(timer); }, [preflight, recoveryCamera, sheet, state, uploadUrl]);
  useEffect(() => {
    if (!uploadUrl || !shouldRunScannerScheduler(state) || sheet) return;
    const image = new Image();
    let cancelled = false;
    image.onload = () => { if (!cancelled) { scannerMetrics.current.markCaptureReady(); void preflight(image); } };
    image.onerror = () => {
      if (cancelled) return;
      setUploadBusy(false);
      setFailure("Couldn’t open this photo");
      dispatch("ANALYZE_FAILURE");
    };
    image.src = uploadUrl;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, [dispatch, preflight, sheet, state, uploadUrl]);
  const failed = state === "no_scene" || state === "error";
  const showAnalysisSpinner = state === "captured_analyzing" || (uploadUrl !== null && uploadBusy && state === "live_searching");
  const recoveryActive = recoveryCamera !== null;

  return <>{showIntro && !recoveryActive && <OnboardingStory onFinish={() => setShowIntro(false)} />}<main className="scanner-shell"><section className={`camera-scene ${state === "camera_off" ? "idle" : ""} ${recoveryActive ? "recovery-active" : ""}`} aria-label={recoveryActive ? "Recovery camera" : "Sugar product scanner"}>
    {uploadUrl ? <img ref={uploadPreviewRef} className="camera-preview" src={uploadUrl} alt="Selected products" /> : <video ref={videoRef} className="camera-preview" muted playsInline />}{frozen && !recoveryActive && <img className="camera-preview frozen-preview" src={frozen} alt="Captured products" />}{state !== "camera_off" && <div className="camera-vignette" />}
    {!recoveryActive && <><header className={`camera-controls ${state === "live_searching" && (torchAvailable || cameraControls.closerZoom !== null) ? "" : "end"}`}><div className={lensStyles.controls}>{state === "live_searching" && torchAvailable ? <button className={`round-control torch-control ${torchOn ? "active" : ""}`} onClick={() => void toggleTorch()} aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"} aria-pressed={torchOn}><TorchIcon /></button> : null}{state === "live_searching" && cameraControls.closerZoom !== null ? <button className={`round-control ${closerViewOn ? lensStyles.active : ""}`} onClick={() => void toggleCloserView()} aria-label={closerViewOn ? "Use standard 1× view" : "Zoom in to 2×"} aria-pressed={closerViewOn}><ZoomInIcon /></button> : null}</div><button className={`round-control ${state === "camera_off" ? "flat" : ""}`} onClick={close} aria-label="Close camera"><CloseIcon /></button></header>
    {groups.map((group) => <ProductOverlay key={group.detection.id} group={group} selected={selected === group.detection.id} onSelect={() => { setSelected(group.detection.id); setSheet(true); }} />)}
    {state === "live_searching" && !uploadUrl && <><span className="viewfinder-guide" aria-hidden="true" /><p className="live-hint">{liveHint ?? "Scan a product to see how much sugar it contains"}</p></>}
    {showAnalysisSpinner && <span className="scan-spinner" aria-label="Checking product details" />}
    {state === "camera_off" && <Prompt title="Scan products for sugar" action="Start scanning" onAction={() => void start()} />}{failed && <Prompt title={failure ?? "Couldn’t scan this scene"} action="Try again" onAction={retry} failure />}
    {state === "captured_analyzing" && <CameraCopy>{analysisPhase === "identifying" ? "Product found — checking details…" : analysisPhase === "catalog" ? "Checking the catalog…" : "Taking a little longer than usual…"}</CameraCopy>}
    {state !== "camera_off" && state !== "captured_analyzing" && state !== "results" ? <label className={`gallery-button ${uploadBusy ? "busy" : ""}`} aria-label="Choose a product photo" aria-disabled={uploadBusy}><input type="file" accept="image/*" disabled={uploadBusy} onChange={(e) => { upload(e.target.files?.[0]); e.currentTarget.value = ""; }} /><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM7 15l3-3 2.5 2.5 2-2 2.5 2.5M8 9h.01" /></svg></label> : null}
    {showCameraDiagnostics && cameraDiagnostics ? <CameraDiagnostics snapshot={cameraDiagnostics} /> : null}</>}
    {recoveryCamera && <RecoveryCamera key={`${recoveryCamera.id}-${recoveryCamera.mode}`} mode={recoveryCamera.mode} gtin={recovery?.barcode ?? null} allowLabel={recovery?.id === recoveryCamera.id && recovery.state === "barcode_not_found"} busy={recoveryBusy} cameraReady={recoveryCameraReady} message={recoveryMessage} draft={labelDraft} onCapture={() => void captureRecovery()} onModeChange={(mode) => { recoveryAttempt.current += 1; setRecoveryBusy(false); setRecoveryCamera((current) => current ? { ...current, mode } : current); setLabelDraft(null); setRecoveryMessage(null); }} onRetake={() => { recoveryAttempt.current += 1; setRecoveryBusy(false); setLabelDraft(null); setRecoveryMessage(null); }} onRestartCamera={() => startRecovery(recoveryCamera.id, recoveryCamera.mode)} onClose={() => { recoveryAttempt.current += 1; setRecoveryBusy(false); setRecoveryCameraReady(false); setRecoveryCamera(null); stopStream(); setRecoveryMessage(null); }} onSubmitted={(draft) => { const score = createSugarScore(draft.sugarPer100g, "nutrition_label"); setScan((current) => current ? { ...current, detections: current.detections.map((detection) => detection.id === recoveryCamera.id ? { ...detection, status: "estimate", visualCandidate: { brand: draft.brand ?? detection.visualCandidate.brand, name: draft.name ?? detection.visualCandidate.name, packSize: draft.packSize ?? detection.visualCandidate.packSize, gtin: recovery?.barcode ?? detection.visualCandidate.gtin }, product: { id: detection.product?.id ?? `demo-label-${detection.id}`, gtin: recovery?.barcode ?? null, brand: draft.brand ?? detection.visualCandidate.brand, name: draft.name ?? detection.visualCandidate.name ?? "Unidentified product", packSize: draft.packSize, imageUrl: null, energyKcalPer100g: draft.energyKcal, proteinPer100g: draft.proteinPer100g, fatPer100g: draft.fatPer100g, carbohydratesPer100g: draft.carbohydratesPer100g, score }, score, estimateReason: "Provisional nutrition-label draft — pending curator review." } : detection) } : current); recoveryAttempt.current += 1; setRecoveryBusy(false); setRecoveryCameraReady(false); setRecoveryCamera(null); stopStream(); setRecoveryMessage(null); setRecoverySubmissionBanner("Submitted for curator review. This demo result is provisional and has not changed the confirmed catalog."); setSheet(true); setSelected(recoveryCamera.id); }} onDraftChange={setLabelDraft} />}
  </section>{state === "results" && !recoveryActive && <button className="result-handle" onClick={() => setSheet(true)}><span className="handle-dot found" /><span>{groups.length} products found</span><span className="handle-detail">Details</span><Chevron /></button>}{sheet && !recoveryActive && <ResultsSheet groups={groups} selectedId={selected} recovery={recovery} recoveryBanner={recoverySubmissionBanner} onRecover={startRecovery} onSelect={setSelected} onClose={() => { setSheet(false); setSelected(null); }} />}<canvas ref={canvasRef} className="hidden-canvas" /></main></>;
}

function RecoveryCamera({ mode, gtin, allowLabel, busy, cameraReady, message, draft, onCapture, onModeChange, onRetake, onRestartCamera, onClose, onSubmitted, onDraftChange }: { mode: "package" | "label"; gtin: string | null; allowLabel: boolean; busy: boolean; cameraReady: boolean; message: string | null; draft: NutritionLabelDraft | null; onCapture: () => void; onModeChange: (mode: "package" | "label") => void; onRetake: () => void; onRestartCamera: () => void; onClose: () => void; onSubmitted: (draft: NutritionLabelDraft) => void; onDraftChange: (draft: NutritionLabelDraft | null) => void }) {
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "error">("idle"), [hasAttempt, setHasAttempt] = useState(false);
  const update = (key: keyof NutritionLabelDraft, value: string) => { if (!draft) return; const numeric = ["energyKcal", "proteinPer100g", "fatPer100g", "carbohydratesPer100g", "sugarPer100g"].includes(key); onDraftChange({ ...draft, [key]: numeric ? (value === "" ? null : Number(value)) : value }); };
  const submit = async () => { if (!draft || submitState === "saving") return; setSubmitState("saving"); try { const response = await fetch("/api/catalog/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gtin, brand: draft.brand ?? "Unknown", name: draft.name ?? "Unidentified product", packSize: draft.packSize, energyKcal: draft.energyKcal, proteinPer100g: draft.proteinPer100g, fatPer100g: draft.fatPer100g, carbohydratesPer100g: draft.carbohydratesPer100g, sugarPer100g: draft.sugarPer100g, labelSeenLocally: true, intakeProvenance: "gemini_label", labelCaptureConsented: true, nutritionFieldConfidence: { energyKcal: draft.fieldConfidence.energyKcal, proteinPer100g: draft.fieldConfidence.proteinPer100g, fatPer100g: draft.fieldConfidence.fatPer100g, carbohydratesPer100g: draft.fieldConfidence.carbohydratesPer100g, sugarPer100g: draft.fieldConfidence.sugarPer100g } }) }); if (!response.ok) throw new Error("proposal"); onSubmitted(draft); } catch { setSubmitState("error"); } };
  const cameraProblem = !cameraReady && message?.startsWith("Camera unavailable");
  return <div className="recovery-camera" role="dialog" aria-modal="true" aria-label="Recovery camera"><div className="recovery-camera-shade"><button className="round-control" onClick={onClose} aria-label="Close recovery"><CloseIcon /></button><div className="recovery-camera-copy"><strong>{mode === "package" ? "Photograph the package barcode" : "Photograph Nutrition Facts"}</strong><span>{mode === "package" ? "One still photo. Nothing is analysed continuously." : "One consented Gemini request after you tap Take photo."}</span></div>{!draft && <button className="recovery-take" disabled={busy || !cameraReady} onClick={() => { setHasAttempt(true); onCapture(); }}>{busy ? "Reading…" : !cameraReady ? "Starting camera…" : hasAttempt ? "Retake" : "Take photo"}</button>}{cameraProblem && <button className="recovery-secondary" onClick={onRestartCamera}>Try camera again</button>}{mode === "package" && allowLabel && !draft && !cameraProblem && <button className="recovery-secondary" disabled={busy || !cameraReady} onClick={() => onModeChange("label")}>Take nutrition-label photo</button>}{message && <p className="recovery-status" aria-live="polite">{message}</p>}{draft && <div className="recovery-draft"><strong>Review draft — provisional, pending curator review</strong>{(["brand", "name", "packSize", "energyKcal", "proteinPer100g", "fatPer100g", "carbohydratesPer100g", "sugarPer100g"] as (keyof NutritionLabelDraft)[]).map((key) => <label key={key}>{key}<input disabled={submitState === "saving"} value={typeof draft[key] === "object" ? "" : String(draft[key] ?? "")} onChange={(event) => update(key, event.target.value)} /></label>)}{submitState === "error" && <p className="recovery-submit-error" role="alert">Couldn’t submit the draft. Your edits are still here — try again.</p>}<div className="recovery-draft-actions recovery-draft-submit"><button disabled={submitState === "saving"} onClick={onRetake}>Retake</button><button disabled={submitState === "saving"} onClick={() => void submit()}>{submitState === "saving" ? "Submitting…" : "OK — submit for review"}</button></div></div>}</div></div>;
}

function Prompt({ title, action, onAction, failure = false }: { title: string; action: string; onAction: () => void; failure?: boolean }) { return <div className={`scanner-prompt ${failure ? "failure" : ""}`} role={failure ? "status" : undefined}><strong>{title}</strong><button onClick={onAction}>{action}</button></div>; }
function CameraCopy({ children }: { children: React.ReactNode }) { return <div className="camera-copy" aria-live="polite">{children}<span>Photos are sent for analysis and are not saved.</span></div>; }
function CameraDiagnostics({ snapshot }: { snapshot: CameraDiagnosticSnapshot }) { const { settings, capabilities, source, imageCapture } = snapshot; return <aside className="camera-diagnostics" aria-label="Local camera diagnostics"><strong>Camera diagnostics</strong><span>{source.sessionId ?? "camera unavailable"} · {settings.width ?? "?"}×{settings.height ?? "?"} · {settings.frameRate ?? "?"} fps</span><span>{settings.facingMode ?? "unknown"} · zoom {settings.zoom ?? "n/a"}{capabilities.zoom ? ` (${capabilities.zoom.min ?? "?"}–${capabilities.zoom.max ?? "?"})` : ""}</span><span>ImageCapture {imageCapture.takePhoto ? "takePhoto available" : "not available"}</span></aside>; }
function ProductOverlay({ group, selected, onSelect }: { group: DetectionGroup; selected: boolean; onSelect: () => void }) { const { detection, box, count } = group; const label = detection.score.sugarPer100g === null ? "Check" : ({ green: "Low", yellow: "Moderate", orange: "High", red: "Very high", unknown: "Check" } as const)[detection.score.band]; const labelInside = box.y < .14; return <button className={`product-overlay ${detection.score.sugarPer100g === null ? "unknown" : detection.score.band} ${labelInside ? "label-inside" : ""} ${selected ? "selected" : ""}`} onClick={onSelect} aria-expanded={selected} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><span className="overlay-label">{label}</span>{count > 1 && <span className="repeat-chip">×{count}</span>}{selected && <span className="overlay-check"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg></span>}</button>; }
function ResultsSheet({ groups, selectedId, recovery, recoveryBanner, onRecover, onSelect, onClose }: { groups: DetectionGroup[]; selectedId: string | null; recovery: RecoveryInfo | null; recoveryBanner: string | null; onRecover: (id: string, mode?: "package" | "label") => void; onSelect: (id: string | null) => void; onClose: () => void }) { return <section className="result-sheet" aria-label="Recognized products"><div className="sheet-header"><button className="sheet-grabber" onClick={onClose} aria-label="Close details" /><span>{groups.length} products found</span><button onClick={onClose} aria-label="Close product list"><CloseIcon /></button></div>{recoveryBanner && <p className="recovery-submission-banner" role="status">{recoveryBanner}</p>}<p className="sheet-intro">Tap a product to see its sugar impact.</p><div className="product-list">{groups.map(({ detection, count }) => { const open = selectedId === detection.id, hasSugar = detection.score.sugarPer100g !== null, title = [detection.visualCandidate.brand, detection.visualCandidate.name].filter(Boolean).join(" · "), source = detection.product?.provenance, recoveryForProduct = recovery?.id === detection.id ? recovery : null; return <article key={detection.id} className={`product-row ${open ? "open" : ""}`}><button className="product-summary" onClick={() => onSelect(open ? null : detection.id)}><span className={`score-orb ${hasSugar ? detection.score.band : "unknown"}`}><svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10" /></svg></span><span className="product-name"><strong>{title || "Unidentified product"}</strong><span className={`status-tag ${detection.status === "confirmed" ? "confirmed" : detection.status === "estimate" ? "estimate" : "unconfirmed"}`}>{detection.status === "confirmed" ? "Confirmed" : detection.status === "estimate" ? "AI estimate" : "Needs confirmation"}</span></span>{count > 1 && <span className="repeat-count">×{count}</span>}<span className="sugar-value">{displaySugar(detection.score.sugarPer100g)}{hasSugar && "g"}<small>/100g</small></span><Chevron up={open} /></button>{open && <div className="product-details"><div className="sugar-meter"><div className="sugar-meter-label"><span>Sugar level</span><strong>{hasSugar ? bandCopy[detection.score.band] : "Not confirmed"}</strong></div>{hasSugar && meterPosition[detection.score.band] && <div className="sugar-meter-track"><span className="sugar-meter-marker" style={{ left: meterPosition[detection.score.band] as string }} /></div>}</div>{count > 1 && <div><span>In this scan</span><strong>{count} matching products</strong></div>}<div className="nutrition-facts"><div className="nutrition-facts-label"><span>Nutrition facts</span><span>Per 100g</span></div><div className="nutrition-facts-grid"><div className="nutrition-fact"><span>Energy</span><strong className={detection.product?.energyKcalPer100g == null ? "unconfirmed" : ""}>{detection.product?.energyKcalPer100g != null ? `${Math.round(detection.product.energyKcalPer100g)} kcal` : "Not confirmed"}</strong></div><div className="nutrition-fact"><span>Protein</span><strong className={detection.product?.proteinPer100g == null ? "unconfirmed" : ""}>{detection.product?.proteinPer100g != null ? `${displaySugar(detection.product.proteinPer100g)}g` : "Not confirmed"}</strong></div><div className="nutrition-fact"><span>Fat</span><strong className={detection.product?.fatPer100g == null ? "unconfirmed" : ""}>{detection.product?.fatPer100g != null ? `${displaySugar(detection.product.fatPer100g)}g` : "Not confirmed"}</strong></div><div className="nutrition-fact"><span>Carbs</span><strong className={detection.product?.carbohydratesPer100g == null ? "unconfirmed" : ""}>{detection.product?.carbohydratesPer100g != null ? `${displaySugar(detection.product.carbohydratesPer100g)}g` : "Not confirmed"}</strong></div></div></div><div><span>Source</span><strong>{source ? sourceCopy[source.source] : detection.status === "estimate" ? "AI estimate" : "Not confirmed"}</strong></div>{detection.estimateReason && <p>{detection.estimateReason}</p>}{shouldOfferBarcodeRecovery(detection.status, open) && <RecoveryCard recovery={recoveryForProduct} candidate={detection.visualCandidate} onStart={() => onRecover(detection.id)} onLabel={() => onRecover(detection.id, "label")} />}</div>}</article>; })}</div></section>; }

function RecoveryCard({ recovery, candidate, onStart, onLabel }: { recovery: RecoveryInfo | null; candidate: Detection["visualCandidate"]; onStart: () => void; onLabel: () => void }) { const message = recovery?.state === "searching" ? "Take one package photo; the barcode is checked on this device." : recovery?.state === "barcode_found" ? "Barcode found — checking the catalog…" : recovery?.state === "barcode_not_found" ? "Barcode not recognised or not in the confirmed catalog." : "Turn the package to its barcode or nutrition label."; return <div className="barcode-recovery-card"><strong>Need a confirmed result?</strong><p>{message}</p>{recovery?.state === "barcode_not_found" && <button onClick={onLabel}>Take nutrition-label photo</button>}{recovery?.state === "barcode_not_found" && recovery.barcode ? <CatalogProposalForm barcode={recovery.barcode} candidate={candidate} labelSeenLocally={false} /> : null}{!recovery && <button onClick={onStart}>Continue with package</button>}</div>; }

function CatalogProposalForm({ barcode, candidate, labelSeenLocally }: { barcode: string; candidate: Detection["visualCandidate"]; labelSeenLocally: boolean }) { const [brand, setBrand] = useState(candidate.brand ?? ""), [name, setName] = useState(candidate.name ?? ""), [packSize, setPackSize] = useState(candidate.packSize ?? ""), [sugar, setSugar] = useState(""), [protein, setProtein] = useState(""), [status, setStatus] = useState<"idle" | "saving" | "saved" | "duplicate" | "error">("idle"); const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setStatus("saving"); const numberOrNull = (value: string) => value.trim() === "" ? null : Number(value); try { const response = await fetch("/api/catalog/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gtin: barcode, brand, name, packSize: packSize.trim() || null, sugarPer100g: numberOrNull(sugar), proteinPer100g: numberOrNull(protein), labelSeenLocally }) }); setStatus(catalogProposalSubmissionOutcome(response.status)); } catch { setStatus("error"); } }; if (status === "saved") return <p className="barcode-recovery-note">Suggestion sent for review. It will not change results until a curator verifies it.</p>; if (status === "duplicate") return <p className="barcode-recovery-note">This barcode is already waiting for curator review.</p>; return <form className="catalog-proposal-form" onSubmit={submit}><strong>Suggest this product</strong><p>Enter only what is printed on the package. Your photo and label text stay on this device.</p><label>Brand<input required maxLength={120} value={brand} onChange={(event) => setBrand(event.target.value)} /></label><label>Product name<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Pack size<input maxLength={40} placeholder="e.g. 330 ml" value={packSize} onChange={(event) => setPackSize(event.target.value)} /></label><div className="catalog-proposal-nutrition"><label>Sugar / 100g<input inputMode="decimal" min="0" max="100" type="number" step="0.1" value={sugar} onChange={(event) => setSugar(event.target.value)} /></label><label>Protein / 100g<input inputMode="decimal" min="0" max="100" type="number" step="0.1" value={protein} onChange={(event) => setProtein(event.target.value)} /></label></div>{status === "error" && <p className="catalog-proposal-error">Couldn’t send this suggestion. Check the fields and try again.</p>}<button disabled={status === "saving"}>{status === "saving" ? "Sending…" : "Send for review"}</button></form>; }
