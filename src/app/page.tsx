"use client";

import "./barcode-recovery.css";

import { useCallback, useEffect, useRef, useState } from "react";
import lensStyles from "./camera-lens.module.css";
import type { AnalyzeScanResponse, Detection, PreflightScanResponse } from "@/lib/contracts/scan";
import { formatSugarPer100g } from "@/lib/scoring/format-sugar";
import { groupRepeatedDetections, type DetectionGroup } from "@/lib/scan/deduplicate-detections";
import { getCenteredFrameCrop, mapAnalyzedBoxToPreview } from "@/lib/scan/frame-crop";
import { getCameraDiagnosticSnapshot, type CameraDiagnosticSnapshot } from "@/lib/scan/camera-diagnostics";
import { applyCameraView, getCameraControls, getCameraDeviceId, preferCameraCaptureQuality, rearCameraRequest, supportsTorch, type CameraControls } from "@/lib/scan/media-capabilities";
import { shouldRunScannerScheduler, transitionScannerLifecycle, type ScannerLifecycleEvent, type ScannerLifecycleState } from "@/lib/scan/scanner-lifecycle";
import { attemptLocalNutritionOcr, decodeLocalBarcode, getLocalBarcodeDetector, getLocalTextDetector, type RecoveryState } from "@/lib/recovery/local-recovery";
import type { BarcodeRecoveryResponse } from "@/lib/contracts/scan";
import { shouldOfferBarcodeRecovery } from "@/lib/recovery/recovery-ui";
import { catalogProposalSubmissionOutcome } from "@/lib/recovery/catalog-proposal-ui";

const FRAME_INTERVAL = 650;
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
  const videoRef = useRef<HTMLVideoElement>(null), uploadPreviewRef = useRef<HTMLImageElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), streamRef = useRef<MediaStream | null>(null), abortRef = useRef<AbortController | null>(null), inFlight = useRef(false), session = useRef(0), frame = useRef(0), recoveryTimer = useRef<number | null>(null), preferredCameraDeviceId = useRef<string | null>(null);
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
  const groups = groupRepeatedDetections((scan?.detections ?? []).filter(eligible));
  const dispatch = useCallback((event: ScannerLifecycleEvent) => setState((current) => transitionScannerLifecycle(current, event)), []);
  const stopStream = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; inFlight.current = false; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setTorchOn(false); setTorchAvailable(false); setCameraDiagnostics(null); setCameraControls({ torchAvailable: false, standardZoom: null, closerZoom: null }); setCloserViewOn(false); if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; } }, []);
  const clearResult = useCallback(() => { if (recoveryTimer.current !== null) window.clearInterval(recoveryTimer.current); recoveryTimer.current = null; setRecovery(null); setScan(null); setFrozen(null); setFailure(null); setSheet(false); setSelected(null); setUploadBusy(false); }, []);

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
    const image = capture(source, 960, .7, 1.12); if (!image || id !== session.current) return;
    if (source instanceof HTMLVideoElement) setFrozen(image);
    dispatch("CAPTURED");
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/scan/analyze", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", context: "shelf", clientFrameId: `frame-${++frame.current}` }) });
      if (id !== session.current) return;
      if (!response.ok) { setFailure("Couldn’t analyze this capture"); dispatch("ANALYZE_FAILURE"); return; }
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
    } catch (error) { if (id === session.current && !(error instanceof DOMException && error.name === "AbortError")) { setFailure("Couldn’t analyze this frame"); dispatch("ANALYZE_FAILURE"); } }
    finally {
      if (id === session.current && source instanceof HTMLImageElement) setUploadBusy(false);
      if (id === session.current && abortRef.current === controller) { inFlight.current = false; abortRef.current = null; }
    }
  }, [capture, dispatch]);

  const preflight = useCallback(async (source: HTMLVideoElement | HTMLImageElement) => {
    if (inFlight.current || sheet || !shouldRunScannerScheduler(state)) return;
    const image = capture(source, 448, .55); if (!image) return;
    const id = session.current; inFlight.current = true; const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/scan/preflight", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", context: "shelf", clientFrameId: `preflight-${++frame.current}` }) });
      if (id !== session.current) return;
      if (!response.ok) { if (source instanceof HTMLImageElement) setUploadBusy(false); setFailure("Couldn’t check this scene"); dispatch("ANALYZE_FAILURE"); return; }
      const result = await response.json() as PreflightScanResponse;
      if (id !== session.current) return;
      if (result.decision !== "candidate" || result.packagedProductCount < 1 || result.confidence < .75) { if (source instanceof HTMLImageElement) setUploadBusy(false); setFailure(result.decision === "uncertain" ? "Move closer to a packaged product" : "No packaged products found — move closer"); dispatch("NO_SCENE"); return; }
      await analyze(source, id);
    } catch (error) { if (id === session.current && !(error instanceof DOMException && error.name === "AbortError")) { if (source instanceof HTMLImageElement) setUploadBusy(false); setFailure("Couldn’t check this scene"); dispatch("ANALYZE_FAILURE"); } }
    finally {
      // Full analysis owns its own controller. Do not clear inFlight here once
      // it has begun: that would let an upload/live scheduler start another
      // request or make Close unable to abort the full Gemini request.
      if (id === session.current && abortRef.current === controller) { inFlight.current = false; abortRef.current = null; }
    }
  }, [analyze, capture, dispatch, sheet, state]);

  const start = useCallback(async () => {
    const id = ++session.current; stopStream(); clearResult(); setUploadUrl(null); setState((current) => transitionScannerLifecycle(current, current === "camera_off" ? "START" : "RETRY"));
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
      setCameraControls(controls); setTorchAvailable(controls.torchAvailable); setCameraDiagnostics(getCameraDiagnosticSnapshot(track)); videoRef.current.srcObject = stream; await videoRef.current.play();
      if (id !== session.current) { stream.getTracks().forEach((t) => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; streamRef.current = null; }
    }
    catch { if (id === session.current) { setFailure("Camera unavailable. Check permission and try again."); setState((current) => transitionScannerLifecycle(current, "ANALYZE_FAILURE")); } }
  }, [clearResult, stopStream]);
  const close = useCallback(() => { session.current += 1; stopStream(); clearResult(); setUploadUrl(null); dispatch("CLOSE_CAMERA"); }, [clearResult, dispatch, stopStream]);
  const toggleTorch = useCallback(async () => { const track = streamRef.current?.getVideoTracks()[0]; const next = !torchOn; if (!track || !supportsTorch(track)) return setTorchAvailable(false); try { await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] }); setTorchOn(next); } catch { setTorchAvailable(false); setTorchOn(false); } }, [torchOn]);
  const toggleCloserView = useCallback(async () => { const track = streamRef.current?.getVideoTracks()[0]; const next = !closerViewOn; try { const applied = await applyCameraView(track, cameraControls, next ? "closer" : "standard"); if (!applied) { setCameraControls((current) => ({ ...current, closerZoom: null })); setCloserViewOn(false); return; } setCloserViewOn(next); setCameraDiagnostics(getCameraDiagnosticSnapshot(track)); } catch { setCameraControls((current) => ({ ...current, closerZoom: null })); setCloserViewOn(false); } }, [cameraControls, closerViewOn]);
  const retry = useCallback(() => { if (!uploadUrl) void start(); else { session.current += 1; clearResult(); setUploadBusy(true); dispatch("RETRY"); } }, [clearResult, dispatch, start, uploadUrl]);
  const startRecovery = useCallback((id: string) => {
    const video = videoRef.current;
    const barcodeDetector = getLocalBarcodeDetector(), textDetector = getLocalTextDetector();
    if (!video || !streamRef.current || (!barcodeDetector && !textDetector)) { setRecovery({ id, state: "unavailable", labelSeen: false, barcode: null }); return; }
    if (recoveryTimer.current !== null) window.clearInterval(recoveryTimer.current);
    const recoverySession = session.current; setFrozen(null); setSheet(false); setRecovery({ id, state: "searching", labelSeen: false, barcode: null });
    const look = async () => {
      const source = videoRef.current; if (!source || recoverySession !== session.current) return;
      const [barcode, labelSeen] = await Promise.all([decodeLocalBarcode(source, barcodeDetector), attemptLocalNutritionOcr(source, textDetector)]);
      if (recoverySession !== session.current) return;
      if (labelSeen) setRecovery((current) => current?.id === id ? { ...current, labelSeen: true } : current);
      if (!barcode) return;
      if (recoveryTimer.current !== null) window.clearInterval(recoveryTimer.current); recoveryTimer.current = null;
      setRecovery((current) => current?.id === id ? { ...current, state: "barcode_found", barcode } : current);
      try {
        const response = await fetch("/api/scan/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gtin: barcode }) });
        if (!response.ok || recoverySession !== session.current) return;
        const result = await response.json() as BarcodeRecoveryResponse;
        // A missed catalog lookup never overwrites the original estimate/unknown result.
        if (result.status === "confirmed") setScan((current) => current ? { ...current, detections: current.detections.map((detection) => detection.id === id ? { ...detection, status: result.status, product: result.product, score: result.score, estimateReason: result.estimateReason, visualCandidate: { ...detection.visualCandidate, gtin: barcode } } : detection) } : current);
        else { setRecovery((current) => current?.id === id ? { ...current, state: "barcode_not_found", barcode } : current); setSheet(true); }
      } catch { /* No recovery frame or OCR text is logged, persisted, or uploaded. */ }
    };
    void look(); recoveryTimer.current = window.setInterval(() => void look(), 800);
  }, []);
  const startErrorBarcodeRecovery = useCallback(() => {
    const video = videoRef.current;
    const barcodeDetector = getLocalBarcodeDetector();
    if (!video || !streamRef.current || !barcodeDetector) { setFailure("Barcode scanning is not supported by this browser yet"); return; }
    if (recoveryTimer.current !== null) window.clearInterval(recoveryTimer.current);
    const recoverySession = session.current;
    setFailure("Point the camera at the barcode");
    const look = async () => {
      const source = videoRef.current;
      if (!source || recoverySession !== session.current) return;
      const barcode = await decodeLocalBarcode(source, barcodeDetector);
      if (!barcode || recoverySession !== session.current) return;
      if (recoveryTimer.current !== null) window.clearInterval(recoveryTimer.current);
      recoveryTimer.current = null;
      setFailure("Barcode found — checking the catalog…");
      try {
        const response = await fetch("/api/scan/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gtin: barcode }) });
        if (!response.ok || recoverySession !== session.current) return;
        const result = await response.json() as BarcodeRecoveryResponse;
        if (result.status !== "confirmed" || !result.product) { setFailure("This barcode is not in the confirmed catalog yet"); return; }
        const detection: Detection = { id: `barcode-${barcode}`, box: { x: .12, y: .25, width: .76, height: .5 }, confidence: 1, status: result.status, visualCandidate: { brand: result.product.brand, name: result.product.name, packSize: result.product.packSize, gtin: barcode }, score: result.score, product: result.product, estimateReason: result.estimateReason };
        setScan({ scanId: `barcode-${barcode}`, clientFrameId: `barcode-${barcode}`, provider: "mock", detections: [detection], analyzedAt: new Date().toISOString() });
        setSelected(detection.id); setSheet(true); setFailure(null); dispatch("BARCODE_SUCCESS");
      } catch { setFailure("Couldn’t check this barcode"); }
    };
    void look(); recoveryTimer.current = window.setInterval(() => void look(), 800);
  }, [dispatch]);
  function upload(file: File | undefined) {
    if (!file || uploadBusy) return;
    session.current += 1;
    stopStream();
    clearResult();
    setUploadBusy(true);
    setUploadUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    setState((current) => transitionScannerLifecycle(current, current === "camera_off" ? "START" : "RETRY"));
  }
  useEffect(() => () => { session.current += 1; if (recoveryTimer.current !== null) window.clearInterval(recoveryTimer.current); stopStream(); }, [stopStream]);
  useEffect(() => setShowCameraDiagnostics(new URLSearchParams(window.location.search).has("cameraDebug")), []);
  useEffect(() => { if (!shouldRunScannerScheduler(state) || sheet || uploadUrl) return; const timer = window.setInterval(() => { if (videoRef.current?.readyState && !inFlight.current) void preflight(videoRef.current); }, FRAME_INTERVAL); return () => window.clearInterval(timer); }, [preflight, sheet, state, uploadUrl]);
  useEffect(() => {
    if (!uploadUrl || !shouldRunScannerScheduler(state) || sheet) return;
    const image = new Image();
    let cancelled = false;
    image.onload = () => { if (!cancelled) void preflight(image); };
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

  return <main className="scanner-shell"><section className={`camera-scene ${state === "camera_off" ? "idle" : ""}`} aria-label="Sugar product scanner">
    {uploadUrl ? <img ref={uploadPreviewRef} className="camera-preview" src={uploadUrl} alt="Selected products" /> : <video ref={videoRef} className="camera-preview" muted playsInline />}{frozen && <img className="camera-preview frozen-preview" src={frozen} alt="Captured products" />}{state !== "camera_off" && <div className="camera-vignette" />}
    <header className={`camera-controls ${state === "live_searching" && (torchAvailable || cameraControls.closerZoom !== null) ? "" : "end"}`}><div className={lensStyles.controls}>{failed ? <button className="round-control" onClick={() => void startErrorBarcodeRecovery()} aria-label="Scan a barcode"><BarcodeIcon /></button> : null}{state === "live_searching" && torchAvailable ? <button className={`round-control torch-control ${torchOn ? "active" : ""}`} onClick={() => void toggleTorch()} aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"} aria-pressed={torchOn}><TorchIcon /></button> : null}{state === "live_searching" && cameraControls.closerZoom !== null ? <button className={`round-control ${closerViewOn ? lensStyles.active : ""}`} onClick={() => void toggleCloserView()} aria-label={closerViewOn ? "Use standard 1× view" : "Zoom in to 2×"} aria-pressed={closerViewOn}><ZoomInIcon /></button> : null}</div><button className={`round-control ${state === "camera_off" ? "flat" : ""}`} onClick={close} aria-label="Close camera"><CloseIcon /></button></header>
    {groups.map((group) => <ProductOverlay key={group.detection.id} group={group} selected={selected === group.detection.id} onSelect={() => { setSelected(group.detection.id); setSheet(true); }} />)}
    {state === "live_searching" && !uploadUrl && <><span className="viewfinder-guide" aria-hidden="true" /><p className="live-hint">Point your camera at products</p></>}
    {showAnalysisSpinner && <span className="scan-spinner" aria-label="Checking product details" />}
    {state === "camera_off" && <Prompt title="Scan products for sugar" action="Start scanning" onAction={() => void start()} />}{failed && <Prompt title={failure ?? "Couldn’t scan this scene"} action="Try again" onAction={retry} failure />}
    {state === "captured_analyzing" && <CameraCopy>Product found — checking details…</CameraCopy>}
    {state !== "camera_off" && state !== "captured_analyzing" && state !== "results" ? <label className={`gallery-button ${uploadBusy ? "busy" : ""}`} aria-label="Choose a product photo" aria-disabled={uploadBusy}><input type="file" accept="image/*" disabled={uploadBusy} onChange={(e) => { upload(e.target.files?.[0]); e.currentTarget.value = ""; }} /><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM7 15l3-3 2.5 2.5 2-2 2.5 2.5M8 9h.01" /></svg></label> : null}
    {showCameraDiagnostics && cameraDiagnostics ? <CameraDiagnostics snapshot={cameraDiagnostics} /> : null}
  </section>{state === "results" && <button className="result-handle" onClick={() => setSheet(true)}><span className="handle-dot found" /><span>{groups.length} products found</span><span className="handle-detail">Details</span><Chevron /></button>}{sheet && <ResultsSheet groups={groups} selectedId={selected} recovery={recovery} onRecover={startRecovery} onSelect={setSelected} onClose={() => { setSheet(false); setSelected(null); }} />}<canvas ref={canvasRef} className="hidden-canvas" /></main>;
}

function Prompt({ title, action, onAction, failure = false }: { title: string; action: string; onAction: () => void; failure?: boolean }) { return <div className={`scanner-prompt ${failure ? "failure" : ""}`} role={failure ? "status" : undefined}><strong>{title}</strong><button onClick={onAction}>{action}</button></div>; }
function CameraCopy({ children }: { children: React.ReactNode }) { return <div className="camera-copy" aria-live="polite">{children}<span>Photos are sent for analysis and are not saved.</span></div>; }
function CameraDiagnostics({ snapshot }: { snapshot: CameraDiagnosticSnapshot }) { const { settings, capabilities, source, imageCapture } = snapshot; return <aside className="camera-diagnostics" aria-label="Local camera diagnostics"><strong>Camera diagnostics</strong><span>{source.sessionId ?? "camera unavailable"} · {settings.width ?? "?"}×{settings.height ?? "?"} · {settings.frameRate ?? "?"} fps</span><span>{settings.facingMode ?? "unknown"} · zoom {settings.zoom ?? "n/a"}{capabilities.zoom ? ` (${capabilities.zoom.min ?? "?"}–${capabilities.zoom.max ?? "?"})` : ""}</span><span>ImageCapture {imageCapture.takePhoto ? "takePhoto available" : "not available"}</span></aside>; }
function ProductOverlay({ group, selected, onSelect }: { group: DetectionGroup; selected: boolean; onSelect: () => void }) { const { detection, box, count } = group; const label = detection.score.sugarPer100g === null ? "Check" : ({ green: "Low", yellow: "Moderate", orange: "High", red: "Very high", unknown: "Check" } as const)[detection.score.band]; const labelInside = box.y < .14; return <button className={`product-overlay ${detection.score.sugarPer100g === null ? "unknown" : detection.score.band} ${labelInside ? "label-inside" : ""} ${selected ? "selected" : ""}`} onClick={onSelect} aria-expanded={selected} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><span className="overlay-label">{label}</span>{count > 1 && <span className="repeat-chip">×{count}</span>}{selected && <span className="overlay-check"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg></span>}</button>; }
function ResultsSheet({ groups, selectedId, recovery, onRecover, onSelect, onClose }: { groups: DetectionGroup[]; selectedId: string | null; recovery: RecoveryInfo | null; onRecover: (id: string) => void; onSelect: (id: string | null) => void; onClose: () => void }) { return <section className="result-sheet" aria-label="Recognized products"><div className="sheet-header"><button className="sheet-grabber" onClick={onClose} aria-label="Close details" /><span>{groups.length} products found</span><button onClick={onClose} aria-label="Close product list"><CloseIcon /></button></div><p className="sheet-intro">Tap a product to see its sugar impact.</p><div className="product-list">{groups.map(({ detection, count }) => { const open = selectedId === detection.id, hasSugar = detection.score.sugarPer100g !== null, title = [detection.visualCandidate.brand, detection.visualCandidate.name].filter(Boolean).join(" · "), source = detection.product?.provenance, recoveryForProduct = recovery?.id === detection.id ? recovery : null; return <article key={detection.id} className={`product-row ${open ? "open" : ""}`}><button className="product-summary" onClick={() => onSelect(open ? null : detection.id)}><span className={`score-orb ${hasSugar ? detection.score.band : "unknown"}`}><svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10" /></svg></span><span className="product-name"><strong>{title || "Unidentified product"}</strong><span className={`status-tag ${detection.status === "confirmed" ? "confirmed" : detection.status === "estimate" ? "estimate" : "unconfirmed"}`}>{detection.status === "confirmed" ? "Confirmed" : detection.status === "estimate" ? "AI estimate" : "Needs confirmation"}</span></span>{count > 1 && <span className="repeat-count">×{count}</span>}<span className="sugar-value">{displaySugar(detection.score.sugarPer100g)}{hasSugar && "g"}<small>/100g</small></span><Chevron up={open} /></button>{open && <div className="product-details"><div className="sugar-meter"><div className="sugar-meter-label"><span>Sugar level</span><strong>{hasSugar ? bandCopy[detection.score.band] : "Not confirmed"}</strong></div>{hasSugar && meterPosition[detection.score.band] && <div className="sugar-meter-track"><span className="sugar-meter-marker" style={{ left: meterPosition[detection.score.band] as string }} /></div>}</div>{count > 1 && <div><span>In this scan</span><strong>{count} matching products</strong></div>}<div><span>Protein</span><strong>{detection.product?.proteinPer100g ? `${displaySugar(detection.product.proteinPer100g)}g / 100g` : "Not confirmed"}</strong></div><div><span>Source</span><strong>{source ? sourceCopy[source.source] : detection.status === "estimate" ? "AI estimate" : "Not confirmed"}</strong></div>{detection.estimateReason && <p>{detection.estimateReason}</p>}{shouldOfferBarcodeRecovery(detection.status, open) && <RecoveryCard recovery={recoveryForProduct} candidate={detection.visualCandidate} onStart={() => onRecover(detection.id)} />}</div>}</article>; })}</div></section>; }

function RecoveryCard({ recovery, candidate, onStart }: { recovery: RecoveryInfo | null; candidate: Detection["visualCandidate"]; onStart: () => void }) { const message = recovery?.state === "searching" ? "Turn the package to its barcode or nutrition label. Checking on this device…" : recovery?.state === "barcode_found" ? "Barcode found — checking the catalog…" : recovery?.state === "barcode_not_found" ? "This barcode is not in the confirmed catalog yet." : recovery?.state === "unavailable" ? "Barcode and nutrition-label recovery is not supported by this browser yet." : "Turn the package to its barcode or nutrition label for a local check."; return <div className="barcode-recovery-card"><strong>Need a confirmed result?</strong><p>{message}</p>{recovery?.labelSeen && <p className="barcode-recovery-note">Nutrition label detected locally. Its text is not saved or sent.</p>}{recovery?.state === "barcode_not_found" && recovery.barcode ? <CatalogProposalForm barcode={recovery.barcode} candidate={candidate} labelSeenLocally={recovery.labelSeen} /> : null}{!recovery && <button onClick={onStart}>Continue with package</button>}</div>; }

function CatalogProposalForm({ barcode, candidate, labelSeenLocally }: { barcode: string; candidate: Detection["visualCandidate"]; labelSeenLocally: boolean }) { const [brand, setBrand] = useState(candidate.brand ?? ""), [name, setName] = useState(candidate.name ?? ""), [packSize, setPackSize] = useState(candidate.packSize ?? ""), [sugar, setSugar] = useState(""), [protein, setProtein] = useState(""), [status, setStatus] = useState<"idle" | "saving" | "saved" | "duplicate" | "error">("idle"); const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setStatus("saving"); const numberOrNull = (value: string) => value.trim() === "" ? null : Number(value); try { const response = await fetch("/api/catalog/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gtin: barcode, brand, name, packSize: packSize.trim() || null, sugarPer100g: numberOrNull(sugar), proteinPer100g: numberOrNull(protein), labelSeenLocally }) }); setStatus(catalogProposalSubmissionOutcome(response.status)); } catch { setStatus("error"); } }; if (status === "saved") return <p className="barcode-recovery-note">Suggestion sent for review. It will not change results until a curator verifies it.</p>; if (status === "duplicate") return <p className="barcode-recovery-note">This barcode is already waiting for curator review.</p>; return <form className="catalog-proposal-form" onSubmit={submit}><strong>Suggest this product</strong><p>Enter only what is printed on the package. Your photo and label text stay on this device.</p><label>Brand<input required maxLength={120} value={brand} onChange={(event) => setBrand(event.target.value)} /></label><label>Product name<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Pack size<input maxLength={40} placeholder="e.g. 330 ml" value={packSize} onChange={(event) => setPackSize(event.target.value)} /></label><div className="catalog-proposal-nutrition"><label>Sugar / 100g<input inputMode="decimal" min="0" max="100" type="number" step="0.1" value={sugar} onChange={(event) => setSugar(event.target.value)} /></label><label>Protein / 100g<input inputMode="decimal" min="0" max="100" type="number" step="0.1" value={protein} onChange={(event) => setProtein(event.target.value)} /></label></div>{status === "error" && <p className="catalog-proposal-error">Couldn’t send this suggestion. Check the fields and try again.</p>}<button disabled={status === "saving"}>{status === "saving" ? "Sending…" : "Send for review"}</button></form>; }
