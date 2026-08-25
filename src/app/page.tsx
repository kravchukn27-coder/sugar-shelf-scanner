"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyzeScanResponse, Detection } from "@/lib/contracts/scan";

const FRAME_INTERVAL = 650;
type CameraState = "starting" | "live" | "unsupported" | "error";
const bandCopy = { green: "Low sugar", yellow: "Moderate sugar", orange: "High sugar", red: "Very high sugar", unknown: "Needs a check" } as const;

function Chevron({ up = false }: { up?: boolean }) { return <svg aria-hidden="true" className={up ? "chevron up" : "chevron"} viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>; }
function ScanIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3M8 12h8" /></svg>; }

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestInFlight = useRef(false);
  const frameIndex = useRef(0);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [scan, setScan] = useState<AnalyzeScanResponse | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const detections = scan?.detections ?? [];
  const activeDetections = detections.filter((d) => d.confidence >= 0.55);

  const analyzeFrame = useCallback(async (source: HTMLVideoElement | HTMLImageElement) => {
    const canvas = canvasRef.current;
    const hasSize = "videoWidth" in source ? source.videoWidth > 0 : source.naturalWidth > 0;
    if (!canvas || requestInFlight.current || isSheetOpen || !hasSize) return;
    requestInFlight.current = true;
    setIsScanning(true);
    const width = "videoWidth" in source ? source.videoWidth : source.naturalWidth;
    const height = "videoHeight" in source ? source.videoHeight : source.naturalHeight;
    canvas.width = 960;
    canvas.height = Math.max(1, Math.round((height / width) * 960));
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    const frameId = `frame-${++frameIndex.current}`;
    try {
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
      const response = await fetch("/api/scan/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageBase64, mimeType: "image/jpeg", context: "shelf", clientFrameId: frameId }) });
      if (response.ok) setScan(await response.json() as AnalyzeScanResponse);
    } catch { /* Keep last stable result during a transient network failure. */ }
    finally { requestInFlight.current = false; setIsScanning(false); }
  }, [isSheetOpen]);

  useEffect(() => {
    let active = true;
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) return setCameraState("unsupported");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1920 } }, audio: false });
        if (!active) return stream.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setCameraState("live"); }
      } catch { setCameraState("error"); }
    }
    void startCamera();
    return () => { active = false; streamRef.current?.getTracks().forEach((track) => track.stop()); };
  }, []);
  useEffect(() => {
    if (cameraState !== "live" || isSheetOpen || uploadUrl) return;
    const timer = window.setInterval(() => { if (videoRef.current?.readyState && !requestInFlight.current) void analyzeFrame(videoRef.current); }, FRAME_INTERVAL);
    return () => window.clearInterval(timer);
  }, [analyzeFrame, cameraState, isSheetOpen, uploadUrl]);
  useEffect(() => {
    if (!uploadUrl || isSheetOpen) return;
    const image = new Image(); image.onload = () => void analyzeFrame(image); image.src = uploadUrl;
  }, [analyzeFrame, isSheetOpen, uploadUrl]);
  function onUpload(file: File | undefined) { if (!file) return; setUploadUrl((oldUrl) => { if (oldUrl) URL.revokeObjectURL(oldUrl); return URL.createObjectURL(file); }); setCameraState("live"); setScan(null); }
  function closeSheet() { setIsSheetOpen(false); setSelectedId(null); }

  return <main className="scanner-shell">
    <section className="camera-scene" aria-label="Sugar shelf scanner">
      {uploadUrl ? <img className="camera-preview" src={uploadUrl} alt="Selected shelf" /> : <video ref={videoRef} className="camera-preview" muted playsInline />}
      <div className="camera-vignette" />
      <header className="camera-controls"><span className="round-control" aria-label="Shelf scanner"><ScanIcon /></span><span className="live-indicator"><i /> LIVE</span><button className="round-control" onClick={() => { setScan(null); setUploadUrl(null); }} aria-label="Clear scan"><CloseIcon /></button></header>
      {activeDetections.map((detection) => <ProductOverlay key={detection.id} detection={detection} selected={selectedId === detection.id} onSelect={() => setSelectedId(detection.id)} />)}
      <div className="camera-copy" aria-live="polite">{isScanning ? "Looking at the shelf…" : activeDetections.length ? `${activeDetections.length} products found` : "Point at a shelf to scan"}<span>Photos are sent for analysis and are not saved.</span></div>
      <label className="gallery-button" aria-label="Choose a shelf photo"><input type="file" accept="image/*" capture="environment" onChange={(event) => onUpload(event.target.files?.[0])} /><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM7 15l3-3 2.5 2.5 2-2 2.5 2.5M8 9h.01" /></svg></label>
      {(cameraState === "error" || cameraState === "unsupported") && <div className="camera-notice">Camera unavailable. Choose a shelf photo instead.</div>}
    </section>
    <button className="result-handle" onClick={() => setIsSheetOpen(true)} disabled={!activeDetections.length}><span className="handle-dot" /><span>{activeDetections.length ? `${activeDetections.length} products found` : "Scanning shelf"}</span><span className="handle-detail">Details</span><Chevron /></button>
    {isSheetOpen && <ResultsSheet detections={activeDetections} selectedId={selectedId} onSelect={setSelectedId} onClose={closeSheet} />}
    <canvas ref={canvasRef} className="hidden-canvas" />
  </main>;
}

function ProductOverlay({ detection, selected, onSelect }: { detection: Detection; selected: boolean; onSelect: () => void }) {
  const { box, score } = detection;
  return <button className={`product-overlay ${score.band} ${selected ? "selected" : ""}`} onClick={onSelect} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} aria-label={`View ${detection.visualCandidate.name ?? "product"}`}><span className="overlay-label">{score.sugarPer100g === null ? "Check" : `${bandCopy[score.band]} · ${score.sugarPer100g}g`}</span>{detection.status === "estimate" && <span className="estimate-chip">AI</span>}</button>;
}

function ResultsSheet({ detections, selectedId, onSelect, onClose }: { detections: Detection[]; selectedId: string | null; onSelect: (id: string | null) => void; onClose: () => void }) {
  return <section className="result-sheet" aria-label="Recognized products"><div className="sheet-header"><button className="sheet-grabber" onClick={onClose} aria-label="Close details" /><span>{detections.length} products found</span><button onClick={onClose} aria-label="Close product list"><CloseIcon /></button></div><p className="sheet-intro">Tap a product to see its sugar impact.</p><div className="product-list">{detections.map((detection) => {
    const open = selectedId === detection.id; const title = [detection.visualCandidate.brand, detection.visualCandidate.name].filter(Boolean).join(" · ");
    return <article key={detection.id} className={`product-row ${open ? "open" : ""}`}><button className="product-summary" onClick={() => onSelect(open ? null : detection.id)}><span className={`score-orb ${detection.score.band}`} /><span className="product-name"><strong>{title || "Unidentified product"}</strong><small>{detection.status === "confirmed" ? "Confirmed product" : detection.status === "estimate" ? "AI estimate" : "Needs confirmation"}</small></span><span className="sugar-value">{detection.score.sugarPer100g === null ? "—" : `${detection.score.sugarPer100g}g`}<small>/100g</small></span><Chevron up={open} /></button>{open && <div className="product-details"><div><span>Sugar score</span><strong>{bandCopy[detection.score.band]}</strong></div><div><span>Protein</span><strong>{detection.product?.proteinPer100g ? `${detection.product.proteinPer100g}g / 100g` : "Not confirmed"}</strong></div>{detection.status !== "confirmed" && <div className="confirmation-actions"><button>Scan barcode</button><button>Nutrition label</button></div>}{detection.estimateReason && <p>{detection.estimateReason}</p>}</div>}</article>;
  })}</div></section>;
}
