"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rearCameraRequest } from "@/lib/scan/media-capabilities";

export type RecoveryCaptureMode = "package" | "nutrition_label";

export function RecoveryCamera({ mode, onCapture, onClose }: { mode: RecoveryCaptureMode; onCapture: (imageBase64: string, mode: RecoveryCaptureMode) => Promise<void> | void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void navigator.mediaDevices.getUserMedia(rearCameraRequest()).then(async (stream) => {
      if (cancelled || !videoRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }).catch(() => { if (!cancelled) setError("Camera unavailable. Check permission and try again."); });
    return () => { cancelled = true; stop(); };
  }, [stop]);
  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || busy) return;
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) { setError("Couldn’t capture this photo. Retake it and try again."); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL("image/jpeg", .9).split(",")[1];
    if (!imageBase64) return;
    setBusy(true); setError(null);
    try { await onCapture(imageBase64, mode); } catch { setError("Couldn’t use this photo. Retake it and try again."); }
    finally { setBusy(false); }
  }, [busy, mode, onCapture]);
  const instruction = mode === "package" ? "Center the barcode on the package. We’ll check this one photo on your device." : "Fill the frame with the Nutrition Facts panel. Only this photo is analyzed after you take it.";
  return <main className="scanner-shell recovery-shell"><section className="recovery-camera-scene" aria-label="Recovery camera">
    <video ref={videoRef} className="recovery-camera-preview" muted playsInline aria-label="Camera preview" /><div className="recovery-camera-vignette" aria-hidden="true" />
    <header className="recovery-camera-header"><div><strong>{mode === "package" ? "Package recovery" : "Nutrition label"}</strong><span>{mode === "package" ? "Step 1 of 2" : "Step 2 of 2"}</span></div><button className="round-control" onClick={() => { stop(); onClose(); }} aria-label="Close recovery camera">×</button></header>
    <div className="recovery-camera-guide" aria-hidden="true" />
    <div className="recovery-camera-bottom"><p>{error ?? instruction}</p><button className="recovery-capture" onClick={() => void takePhoto()} disabled={busy || Boolean(error)}>{busy ? "Checking photo…" : "Take photo"}</button></div>
  </section></main>;
}
