"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyzeScanResponse, Detection, PreflightScanResponse } from "@/lib/contracts/scan";
import { formatSugarPer100g } from "@/lib/scoring/format-sugar";
import { groupRepeatedDetections, type DetectionGroup } from "@/lib/scan/deduplicate-detections";
import { shouldRunScannerScheduler, transitionScannerLifecycle, type ScannerLifecycleEvent, type ScannerLifecycleState } from "@/lib/scan/scanner-lifecycle";

const FRAME_INTERVAL = 650;
const bandCopy = { green: "Low sugar", yellow: "Moderate sugar", orange: "High sugar", red: "Very high sugar", unknown: "Needs a check" } as const;
const sourceCopy = { curated: "Sugar catalog", open_food_facts: "Open Food Facts", usda_food_data_central: "USDA FoodData Central", commercial: "Verified provider" } as const;
const eligible = (d: Detection) => d.confidence >= .55 && Boolean(d.visualCandidate.brand || d.visualCandidate.name);
const displaySugar = (value: number | null | undefined) => formatSugarPer100g(value) ?? "—";
type TorchTrack = { getCapabilities?: () => { torch?: boolean } };
const supportsTorch = (track: MediaStreamTrack | undefined) => Boolean((track as unknown as TorchTrack | undefined)?.getCapabilities?.().torch);
function Chevron({ up = false }: { up?: boolean }) { return <svg aria-hidden="true" className={up ? "chevron up" : "chevron"} viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>; }
function ScanIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3M8 12h8" /></svg>; }
function TorchIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6l-1 6h3l-7 12 1-8H8z" /></svg>; }

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), streamRef = useRef<MediaStream | null>(null), abortRef = useRef<AbortController | null>(null), inFlight = useRef(false), session = useRef(0), frame = useRef(0);
  const [state, setState] = useState<ScannerLifecycleState>("camera_off");
  const [failure, setFailure] = useState<string | null>(null);
  const [scan, setScan] = useState<AnalyzeScanResponse | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false), [torchOn, setTorchOn] = useState(false);
  const groups = groupRepeatedDetections((scan?.detections ?? []).filter(eligible));
  const dispatch = useCallback((event: ScannerLifecycleEvent) => setState((current) => transitionScannerLifecycle(current, event)), []);
  const stopStream = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; inFlight.current = false; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setTorchOn(false); setTorchAvailable(false); if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; } }, []);
  const clearResult = useCallback(() => { setScan(null); setFrozen(null); setFailure(null); setSheet(false); setSelected(null); }, []);

  const capture = useCallback((source: HTMLVideoElement | HTMLImageElement, width: number, quality: number) => {
    const canvas = canvasRef.current; const w = "videoWidth" in source ? source.videoWidth : source.naturalWidth; const h = "videoHeight" in source ? source.videoHeight : source.naturalHeight;
    const preview = source.getBoundingClientRect(), aspect = preview.width / preview.height;
    if (!canvas || !w || !h || !Number.isFinite(aspect) || aspect <= 0) return null;
    let sx = 0, sy = 0, sw = w, sh = h;
    if (w / h > aspect) { sw = h * aspect; sx = (w - sw) / 2; } else { sh = w / aspect; sy = (h - sh) / 2; }
    canvas.width = width; canvas.height = Math.max(1, Math.round(width / aspect)); canvas.getContext("2d")?.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }, []);

  const analyze = useCallback(async (source: HTMLVideoElement | HTMLImageElement, id: number) => {
    const image = capture(source, 960, .7); if (!image || id !== session.current) return;
    if (source instanceof HTMLVideoElement) setFrozen(image); dispatch("CAPTURED");
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/scan/analyze", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", context: "shelf", clientFrameId: `frame-${++frame.current}` }) });
      if (id !== session.current) return;
      if (!response.ok) { setFailure("Couldn’t analyze this capture"); dispatch("ANALYZE_FAILURE"); return; }
      const result = await response.json() as AnalyzeScanResponse;
      if (id !== session.current) return;
      if (result.detections.some(eligible)) { setScan(result); dispatch("ANALYZE_SUCCESS"); } else { setFailure("No recognizable packaged products found"); dispatch("NO_SCENE"); }
    } catch (error) { if (id === session.current && !(error instanceof DOMException && error.name === "AbortError")) { setFailure("Couldn’t analyze this frame"); dispatch("ANALYZE_FAILURE"); } }
    finally { if (id === session.current) { inFlight.current = false; abortRef.current = null; } }
  }, [capture, dispatch]);

  const preflight = useCallback(async (source: HTMLVideoElement | HTMLImageElement) => {
    if (inFlight.current || sheet || !shouldRunScannerScheduler(state)) return;
    const image = capture(source, 448, .55); if (!image) return;
    const id = session.current; inFlight.current = true; const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/scan/preflight", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ imageBase64: image.split(",")[1], mimeType: "image/jpeg", context: "shelf", clientFrameId: `preflight-${++frame.current}` }) });
      if (id !== session.current) return;
      if (!response.ok) { setFailure("Couldn’t check this scene"); dispatch("ANALYZE_FAILURE"); return; }
      const result = await response.json() as PreflightScanResponse;
      if (id !== session.current) return;
      if (result.decision !== "candidate" || result.packagedProductCount < 1 || result.confidence < .75) { setFailure(result.decision === "uncertain" ? "Move closer to a packaged product" : "No packaged products found — move closer"); dispatch("NO_SCENE"); return; }
      await analyze(source, id);
    } catch (error) { if (id === session.current && !(error instanceof DOMException && error.name === "AbortError")) { setFailure("Couldn’t check this scene"); dispatch("ANALYZE_FAILURE"); } }
    finally { if (id === session.current && state !== "captured_analyzing") { inFlight.current = false; abortRef.current = null; } }
  }, [analyze, capture, dispatch, sheet, state]);

  const start = useCallback(async () => {
    const id = ++session.current; stopStream(); clearResult(); setUploadUrl(null); setState((current) => transitionScannerLifecycle(current, current === "camera_off" ? "START" : "RETRY"));
    try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1920 } }, audio: false }); if (id !== session.current || !videoRef.current) { stream.getTracks().forEach((t) => t.stop()); return; } streamRef.current = stream; setTorchAvailable(supportsTorch(stream.getVideoTracks()[0])); videoRef.current.srcObject = stream; await videoRef.current.play(); if (id !== session.current) { stream.getTracks().forEach((t) => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; streamRef.current = null; } }
    catch { if (id === session.current) { setFailure("Camera unavailable. Check permission and try again."); setState((current) => transitionScannerLifecycle(current, "ANALYZE_FAILURE")); } }
  }, [clearResult, stopStream]);
  const close = useCallback(() => { session.current += 1; stopStream(); clearResult(); setUploadUrl(null); dispatch("CLOSE_CAMERA"); }, [clearResult, dispatch, stopStream]);
  const toggleTorch = useCallback(async () => { const track = streamRef.current?.getVideoTracks()[0]; const next = !torchOn; if (!track || !supportsTorch(track)) return setTorchAvailable(false); try { await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] }); setTorchOn(next); } catch { setTorchAvailable(false); setTorchOn(false); } }, [torchOn]);
  const retry = useCallback(() => { if (!uploadUrl) void start(); else { session.current += 1; clearResult(); dispatch("RETRY"); } }, [clearResult, dispatch, start, uploadUrl]);
  function upload(file: File | undefined) { if (!file) return; session.current += 1; stopStream(); clearResult(); setUploadUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); }); setState((current) => transitionScannerLifecycle(current, current === "camera_off" ? "START" : "RETRY")); }
  useEffect(() => () => { session.current += 1; stopStream(); }, [stopStream]);
  useEffect(() => { if (!shouldRunScannerScheduler(state) || sheet || uploadUrl) return; const timer = window.setInterval(() => { if (videoRef.current?.readyState && !inFlight.current) void preflight(videoRef.current); }, FRAME_INTERVAL); return () => window.clearInterval(timer); }, [preflight, sheet, state, uploadUrl]);
  useEffect(() => { if (!uploadUrl || !shouldRunScannerScheduler(state) || sheet) return; const image = new Image(); image.onload = () => void preflight(image); image.src = uploadUrl; }, [preflight, sheet, state, uploadUrl]);
  const failed = state === "no_scene" || state === "error", captured = state === "captured_analyzing" || state === "results";

  return <main className="scanner-shell"><section className="camera-scene" aria-label="Sugar product scanner">
    {uploadUrl ? <img className="camera-preview" src={uploadUrl} alt="Selected products" /> : <video ref={videoRef} className="camera-preview" muted playsInline />}{frozen && <img className="camera-preview frozen-preview" src={frozen} alt="Captured products" />}<div className="camera-vignette" />
    <header className="camera-controls">{state === "live_searching" && torchAvailable ? <button className={`round-control torch-control ${torchOn ? "active" : ""}`} onClick={() => void toggleTorch()} aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"} aria-pressed={torchOn}><TorchIcon /></button> : <span className="round-control" aria-label="Product scanner"><ScanIcon /></span>}<span className="live-indicator"><i /> {captured || uploadUrl ? "CAPTURED" : state === "camera_off" ? "READY" : "LIVE"}</span><button className="round-control" onClick={close} aria-label="Close camera"><CloseIcon /></button></header>
    {groups.map((group) => <ProductOverlay key={group.detection.id} group={group} selected={selected === group.detection.id} onSelect={() => { setSelected(group.detection.id); setSheet(true); }} />)}
    {state === "live_searching" && !uploadUrl && <><span className="viewfinder-guide" aria-hidden="true" /><p className="live-hint">Point your camera at products</p></>}
    {state === "captured_analyzing" && <span className="scan-spinner" aria-label="Checking product details" />}
    {state === "camera_off" && <Prompt title="Scan products for sugar" action="Start scanning" onAction={() => void start()} />}{failed && <Prompt title={failure ?? "Couldn’t scan this scene"} action="Try again" onAction={retry} failure />}
    {state === "captured_analyzing" && <CameraCopy>Product found — checking details…</CameraCopy>}{state === "results" && <CameraCopy>{groups.length} products found</CameraCopy>}
    <label className="gallery-button" aria-label="Choose a product photo"><input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} /><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM7 15l3-3 2.5 2.5 2-2 2.5 2.5M8 9h.01" /></svg></label>
  </section>{state === "results" && <button className="result-handle" onClick={() => setSheet(true)}><span className="handle-dot found" /><span>{groups.length} products found</span><span className="handle-detail">Details</span><Chevron /></button>}{sheet && <ResultsSheet groups={groups} selectedId={selected} onSelect={setSelected} onClose={() => { setSheet(false); setSelected(null); }} />}<canvas ref={canvasRef} className="hidden-canvas" /></main>;
}

function Prompt({ title, action, onAction, failure = false }: { title: string; action: string; onAction: () => void; failure?: boolean }) { return <div className={`scanner-prompt ${failure ? "failure" : ""}`} role={failure ? "status" : undefined}><strong>{title}</strong><button onClick={onAction}>{action}</button></div>; }
function CameraCopy({ children }: { children: React.ReactNode }) { return <div className="camera-copy" aria-live="polite">{children}<span>Photos are sent for analysis and are not saved.</span></div>; }
function ProductOverlay({ group, selected, onSelect }: { group: DetectionGroup; selected: boolean; onSelect: () => void }) { const { detection, box, count } = group; const label = detection.score.sugarPer100g === null ? "Check" : ({ green: "Low", yellow: "Moderate", orange: "High", red: "Very high", unknown: "Check" } as const)[detection.score.band]; const labelInside = box.y < .14; return <button className={`product-overlay ${detection.score.sugarPer100g === null ? "unknown" : detection.score.band} ${labelInside ? "label-inside" : ""} ${selected ? "selected" : ""}`} onClick={onSelect} aria-expanded={selected} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><span className="overlay-label">{label}</span>{count > 1 && <span className="repeat-chip">×{count}</span>}</button>; }
function ResultsSheet({ groups, selectedId, onSelect, onClose }: { groups: DetectionGroup[]; selectedId: string | null; onSelect: (id: string | null) => void; onClose: () => void }) { return <section className="result-sheet" aria-label="Recognized products"><div className="sheet-header"><button className="sheet-grabber" onClick={onClose} aria-label="Close details" /><span>{groups.length} products found</span><button onClick={onClose} aria-label="Close product list"><CloseIcon /></button></div><p className="sheet-intro">Tap a product to see its sugar impact.</p><div className="product-list">{groups.map(({ detection, count }) => { const open = selectedId === detection.id, hasSugar = detection.score.sugarPer100g !== null, title = [detection.visualCandidate.brand, detection.visualCandidate.name].filter(Boolean).join(" · "), source = detection.product?.provenance; return <article key={detection.id} className={`product-row ${open ? "open" : ""}`}><button className="product-summary" onClick={() => onSelect(open ? null : detection.id)}><span className={`score-orb ${hasSugar ? detection.score.band : "unknown"}`} /><span className="product-name"><strong>{title || "Unidentified product"}</strong><small>{detection.status === "confirmed" ? "Confirmed product" : detection.status === "estimate" ? "AI estimate" : "Needs confirmation"}</small></span>{count > 1 && <span className="repeat-count">×{count}</span>}<span className="sugar-value">{displaySugar(detection.score.sugarPer100g)}{hasSugar && "g"}<small>/100g</small></span><Chevron up={open} /></button>{open && <div className="product-details"><div><span>Sugar score</span><strong>{hasSugar ? bandCopy[detection.score.band] : "Not confirmed"}</strong></div>{count > 1 && <div><span>In this scan</span><strong>{count} matching products</strong></div>}<div><span>Protein</span><strong>{detection.product?.proteinPer100g ? `${displaySugar(detection.product.proteinPer100g)}g / 100g` : "Not confirmed"}</strong></div><div><span>Source</span><strong>{source ? sourceCopy[source.source] : detection.status === "estimate" ? "AI estimate" : "Not confirmed"}</strong></div>{detection.estimateReason && <p>{detection.estimateReason}</p>}</div>}</article>; })}</div></section>; }
