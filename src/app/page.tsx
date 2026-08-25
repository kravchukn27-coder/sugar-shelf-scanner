"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyzeScanResponse, Detection, PreflightScanResponse } from "@/lib/contracts/scan";

const FRAME_INTERVAL = 650;
const EMPTY_RESULT_COOLDOWN_MS = 4_000;
const ERROR_COOLDOWN_MS = 6_000;
type CameraState = "starting" | "live" | "unsupported" | "error";
type ScanFeedback = "idle" | "preflight" | "analyzing" | "found" | "empty" | "uncertain" | "unresolved" | "error";
const bandCopy = { green: "Low sugar", yellow: "Moderate sugar", orange: "High sugar", red: "Very high sugar", unknown: "Needs a check" } as const;
const sourceCopy = { curated: "Sugar catalog", open_food_facts: "Open Food Facts", usda_food_data_central: "USDA FoodData Central", commercial: "Verified provider" } as const;

function isEligibleDetection(detection: Detection) {
  return detection.confidence >= 0.55 && Boolean(detection.visualCandidate.brand || detection.visualCandidate.name);
}

function Chevron({ up = false }: { up?: boolean }) { return <svg aria-hidden="true" className={up ? "chevron up" : "chevron"} viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>; }
function ScanIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3M8 12h8" /></svg>; }

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestInFlight = useRef(false);
  const nextScanAllowedAt = useRef(0);
  const frameIndex = useRef(0);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [scan, setScan] = useState<AnalyzeScanResponse | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>("idle");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);
  const detections = scan?.detections ?? [];
  const activeDetections = detections.filter(isEligibleDetection);

  const captureFrame = useCallback((source: HTMLVideoElement | HTMLImageElement, targetWidth: number, quality: number) => {
    const canvas = canvasRef.current;
    const hasSize = "videoWidth" in source ? source.videoWidth > 0 : source.naturalWidth > 0;
    if (!canvas || !hasSize) return null;
    const width = "videoWidth" in source ? source.videoWidth : source.naturalWidth;
    const height = "videoHeight" in source ? source.videoHeight : source.naturalHeight;
    // Mirror the `object-fit: cover` crop used by the portrait viewfinder.
    // Gemini then receives exactly the area the person sees, not the uncropped
    // camera buffer around it.
    const preview = source.getBoundingClientRect();
    const previewAspect = preview.width / preview.height;
    if (!Number.isFinite(previewAspect) || previewAspect <= 0) return null;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = width;
    let sourceHeight = height;
    if (width / height > previewAspect) {
      sourceWidth = height * previewAspect;
      sourceX = (width - sourceWidth) / 2;
    } else {
      sourceHeight = width / previewAspect;
      sourceY = (height - sourceHeight) / 2;
    }
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round(targetWidth / previewAspect));
    canvas.getContext("2d")?.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }, []);

  const analyzeConfirmedCandidate = useCallback(async (source: HTMLVideoElement | HTMLImageElement) => {
    // Take a new high-resolution photo after preflight. For a live camera this
    // avoids analysing the deliberately small gate frame.
    const imageDataUrl = captureFrame(source, 960, 0.7);
    if (!imageDataUrl) {
      setScanFeedback("error");
      return ERROR_COOLDOWN_MS;
    }
    const frameId = `frame-${++frameIndex.current}`;
    const isLiveCameraFrame = source instanceof HTMLVideoElement;
    // A positive preflight is the intentional, shutterless capture moment.
    // Keep this exact frame visible while full Gemini recognition finishes.
    if (isLiveCameraFrame) setFrozenFrame(imageDataUrl);
    setScanFeedback("analyzing");
    let retryCooldown = EMPTY_RESULT_COOLDOWN_MS;
    try {
      const imageBase64 = imageDataUrl.split(",")[1];
      const response = await fetch("/api/scan/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageBase64, mimeType: "image/jpeg", context: "shelf", clientFrameId: frameId }) });
      if (!response.ok) {
        retryCooldown = ERROR_COOLDOWN_MS;
        setScanFeedback("error");
        return retryCooldown;
      }
      const nextScan = await response.json() as AnalyzeScanResponse;
      const hasEligibleDetection = nextScan.detections.some(isEligibleDetection);
      if (hasEligibleDetection) {
        setScan(nextScan);
        setScanFeedback("found");
      } else {
        // Do not quietly resume the camera after it intentionally captured a
        // product. The user sees a stable outcome and can explicitly restart.
        setScanFeedback("unresolved");
      }
    } catch {
      retryCooldown = ERROR_COOLDOWN_MS;
      setScanFeedback("error");
    } finally {
      // The caller owns the in-flight lock so preflight + analysis are one
      // atomic scan and can never overlap with a second camera interval.
    }
    return retryCooldown;
  }, [captureFrame]);

  const preflightFrame = useCallback(async (source: HTMLVideoElement | HTMLImageElement) => {
    const isLiveCameraFrame = source instanceof HTMLVideoElement;
    if (requestInFlight.current || isSheetOpen) return;
    const imageDataUrl = captureFrame(source, 448, 0.55);
    if (!imageDataUrl) return;

    requestInFlight.current = true;
    setIsScanning(true);
    setScan(null);
    setScanFeedback("preflight");
    let retryCooldown = EMPTY_RESULT_COOLDOWN_MS;
    try {
      const response = await fetch("/api/scan/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: imageDataUrl.split(",")[1], mimeType: "image/jpeg", context: "shelf", clientFrameId: `preflight-${++frameIndex.current}` }),
      });
      if (!response.ok) {
        retryCooldown = ERROR_COOLDOWN_MS;
        setScanFeedback("error");
        return;
      }
      const preflight = await response.json() as PreflightScanResponse;
      const isCandidate = preflight.decision === "candidate" && preflight.packagedProductCount >= 1 && preflight.confidence >= 0.75;
      if (!isCandidate) {
        retryCooldown = preflight.decision === "uncertain" ? EMPTY_RESULT_COOLDOWN_MS : EMPTY_RESULT_COOLDOWN_MS;
        setScanFeedback(preflight.decision === "uncertain" ? "uncertain" : "empty");
        return;
      }
      retryCooldown = await analyzeConfirmedCandidate(source);
    } catch {
      retryCooldown = ERROR_COOLDOWN_MS;
      setScanFeedback("error");
    } finally {
      requestInFlight.current = false;
      nextScanAllowedAt.current = Date.now() + (isLiveCameraFrame ? retryCooldown : Number.MAX_SAFE_INTEGER);
      setIsScanning(false);
    }
  }, [analyzeConfirmedCandidate, captureFrame, isSheetOpen]);

  useEffect(() => {
    let active = true;
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) return setCameraState("unsupported");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1920 } }, audio: false });
        if (!active) return stream.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); nextScanAllowedAt.current = Date.now() + 1_000; setCameraState("live"); }
      } catch { setCameraState("error"); }
    }
    void startCamera();
    return () => { active = false; streamRef.current?.getTracks().forEach((track) => track.stop()); };
  }, []);
  useEffect(() => {
    if (cameraState !== "live" || isSheetOpen || uploadUrl || frozenFrame) return;
    const timer = window.setInterval(() => {
      // The browser cannot reliably tell a product from a document or a person.
      // Keep the preview live and let Gemini make that decision; only a positive
      // response freezes the submitted frame.
      if (videoRef.current?.readyState && !requestInFlight.current && Date.now() >= nextScanAllowedAt.current) void preflightFrame(videoRef.current);
    }, FRAME_INTERVAL);
    return () => window.clearInterval(timer);
  }, [cameraState, frozenFrame, isSheetOpen, preflightFrame, uploadUrl]);
  useEffect(() => {
    if (!uploadUrl || isSheetOpen) return;
    const image = new Image(); image.onload = () => void preflightFrame(image); image.src = uploadUrl;
  }, [isSheetOpen, preflightFrame, uploadUrl]);
  function onUpload(file: File | undefined) { if (!file) return; setUploadUrl((oldUrl) => { if (oldUrl) URL.revokeObjectURL(oldUrl); return URL.createObjectURL(file); }); setFrozenFrame(null); setCameraState("live"); setScan(null); setScanFeedback("idle"); }
  function closeSheet() { setIsSheetOpen(false); setSelectedId(null); }
  function clearScan() { setScan(null); setUploadUrl(null); setFrozenFrame(null); setScanFeedback("idle"); nextScanAllowedAt.current = Date.now() + 800; }
  const cameraMessage = scanFeedback === "preflight"
    ? "Looking for packaged products…"
    : scanFeedback === "analyzing"
      ? "Product found — checking details…"
    : scanFeedback === "empty"
      ? "No packaged products found — move closer"
      : scanFeedback === "uncertain"
        ? "Move closer to a packaged product"
      : scanFeedback === "unresolved"
        ? "Couldn’t identify this product — tap × to scan again"
      : scanFeedback === "error"
        ? frozenFrame ? "Couldn’t analyze this capture — tap × to scan again" : "Couldn’t analyze this frame — trying again"
        : activeDetections.length
          ? `${activeDetections.length} products found`
          : "Point at packaged products to scan";

  return <main className="scanner-shell">
    <section className="camera-scene" aria-label="Sugar shelf scanner">
      {uploadUrl ? <img className="camera-preview" src={uploadUrl} alt="Selected shelf" /> : <video ref={videoRef} className="camera-preview" muted playsInline />}
      {frozenFrame && <img className="camera-preview frozen-preview" src={frozenFrame} alt="Captured shelf frame" />}
      <div className="camera-vignette" />
      <header className="camera-controls"><span className="round-control" aria-label="Shelf scanner"><ScanIcon /></span><span className="live-indicator"><i /> {frozenFrame || uploadUrl ? "CAPTURED" : "LIVE"}</span><button className="round-control" onClick={clearScan} aria-label="Clear scan"><CloseIcon /></button></header>
      {activeDetections.map((detection) => <ProductOverlay key={detection.id} detection={detection} selected={selectedId === detection.id} onSelect={() => setSelectedId(detection.id)} />)}
      {isScanning && !frozenFrame && <div className="processing-frame" aria-hidden="true"><span>{scanFeedback === "analyzing" ? "Product found" : "Looking"}</span></div>}
      <div className={`camera-copy ${scanFeedback}`} aria-live="polite">{cameraMessage}<span>Photos are sent for analysis and are not saved.</span></div>
      <label className="gallery-button" aria-label="Choose a shelf photo"><input type="file" accept="image/*" onChange={(event) => onUpload(event.target.files?.[0])} /><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM7 15l3-3 2.5 2.5 2-2 2.5 2.5M8 9h.01" /></svg></label>
      {(cameraState === "error" || cameraState === "unsupported") && <div className="camera-notice">Camera unavailable. Choose a shelf photo instead.</div>}
    </section>
    <button className="result-handle" onClick={() => setIsSheetOpen(true)} disabled={!activeDetections.length}><span className={`handle-dot ${scanFeedback}`} /><span>{activeDetections.length ? `${activeDetections.length} products found` : scanFeedback === "empty" ? "No products found" : scanFeedback === "unresolved" || scanFeedback === "error" ? "Scan again" : "Scanning shelf"}</span><span className="handle-detail">Details</span><Chevron /></button>
    {isSheetOpen && <ResultsSheet detections={activeDetections} selectedId={selectedId} onSelect={setSelectedId} onClose={closeSheet} />}
    <canvas ref={canvasRef} className="hidden-canvas" />
  </main>;
}

function ProductOverlay({ detection, selected, onSelect }: { detection: Detection; selected: boolean; onSelect: () => void }) {
  const { box, score } = detection;
  const isConfirmed = detection.status === "confirmed";
  const visualBand = score.sugarPer100g === null ? "unknown" : score.band;
  const label = score.sugarPer100g === null
    ? "Needs confirmation"
    : isConfirmed ? `${bandCopy[score.band]} · ${score.sugarPer100g}g` : `AI estimate · ${score.sugarPer100g}g`;
  return <button className={`product-overlay ${visualBand} ${selected ? "selected" : ""}`} onClick={onSelect} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} aria-label={`View ${detection.visualCandidate.name ?? "product"}`}><span className="overlay-label">{label}</span>{detection.status === "estimate" && <span className="estimate-chip">AI</span>}</button>;
}

function ResultsSheet({ detections, selectedId, onSelect, onClose }: { detections: Detection[]; selectedId: string | null; onSelect: (id: string | null) => void; onClose: () => void }) {
  return <section className="result-sheet" aria-label="Recognized products"><div className="sheet-header"><button className="sheet-grabber" onClick={onClose} aria-label="Close details" /><span>{detections.length} products found</span><button onClick={onClose} aria-label="Close product list"><CloseIcon /></button></div><p className="sheet-intro">Tap a product to see its sugar impact.</p><div className="product-list">{detections.map((detection) => {
    const open = selectedId === detection.id; const title = [detection.visualCandidate.brand, detection.visualCandidate.name].filter(Boolean).join(" · ");
    const isConfirmed = detection.status === "confirmed";
    const provenance = detection.product?.provenance;
    const hasSugarScore = detection.score.sugarPer100g !== null;
    return <article key={detection.id} className={`product-row ${open ? "open" : ""}`}><button className="product-summary" onClick={() => onSelect(open ? null : detection.id)}><span className={`score-orb ${hasSugarScore ? detection.score.band : "unknown"}`} /><span className="product-name"><strong>{title || "Unidentified product"}</strong><small>{isConfirmed ? "Confirmed product" : detection.status === "estimate" ? "AI estimate — needs confirmation" : "Needs confirmation"}</small></span><span className="sugar-value">{detection.score.sugarPer100g === null ? "—" : `${detection.score.sugarPer100g}g`}<small>/100g</small></span><Chevron up={open} /></button>{open && <div className="product-details"><div><span>Sugar score</span><strong>{hasSugarScore ? bandCopy[detection.score.band] : "Not confirmed"}</strong></div><div><span>Protein</span><strong>{detection.product?.proteinPer100g ? `${detection.product.proteinPer100g}g / 100g` : "Not confirmed"}</strong></div><div><span>Source</span><strong>{provenance ? sourceCopy[provenance.source] : detection.status === "estimate" ? "AI estimate" : "Not confirmed"}</strong></div>{detection.status !== "confirmed" && <div className="confirmation-actions"><button>Scan barcode</button><button>Nutrition label</button></div>}{detection.estimateReason && <p>{detection.estimateReason}</p>}</div>}</article>;
  })}</div></section>;
}
