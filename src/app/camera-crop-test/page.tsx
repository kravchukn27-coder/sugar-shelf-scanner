"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyCameraView, getCameraControls, preferCameraCaptureQuality, rearCameraRequest } from "@/lib/scan/media-capabilities";
import { getCameraDiagnosticSnapshot, type CameraDiagnosticSnapshot } from "@/lib/scan/camera-diagnostics";

/**
 * Standalone test route for the zero-crop viewfinder treatment ("Option 1"),
 * isolated from the real scanner so it never risks page.tsx. Reuses the same
 * getUserMedia + zoom-constraint code the real scanner uses (rearCameraRequest,
 * preferCameraCaptureQuality, applyCameraView) — only the display CSS differs:
 * object-fit: contain instead of cover, so the full sensor frame is visible
 * with letterboxing rather than cropped to fill the screen.
 *
 * Not linked from anywhere in the app; reach it directly at /camera-crop-test.
 */
export default function CameraCropTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<CameraDiagnosticSnapshot | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; }
    setRunning(false);
    setDiagnostics(null);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(rearCameraRequest());
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      try { await preferCameraCaptureQuality(track); } catch { /* keep the device-selected mode */ }
      const controls = getCameraControls(track);
      if (controls.standardZoom !== null) { try { await applyCameraView(track, controls, "standard"); } catch { /* keep current zoom */ } }
      if (!videoRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setDiagnostics(getCameraDiagnosticSnapshot(track));
      setRunning(true);
    } catch {
      setError("Camera unavailable. Check permission and try again.");
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return (
    <main style={{ minHeight: "100svh", background: "#070708", color: "#fff", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: "max(14px,env(safe-area-inset-top))", left: 0, right: 0, zIndex: 5, display: "flex", justifyContent: "center" }}>
        <span style={{ background: "rgba(20,18,24,.72)", backdropFilter: "blur(10px)", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 700, letterSpacing: ".01em" }}>
          TEST — zero-crop viewfinder (object-fit: contain)
        </span>
      </div>

      {running && (
        <>
          <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#0a0a0c" }} />
          <span className="viewfinder-guide" aria-hidden="true" />
          <p className="live-hint">Scan a product to see how it fits your day</p>
        </>
      )}

      {!running && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div style={{ display: "grid", gap: 16, maxWidth: 320 }}>
            <p style={{ margin: 0, color: "rgba(255,255,255,.7)", fontSize: 14, lineHeight: 1.5 }}>
              Same camera start code as the real scanner (rear camera, zoom forced to 1×), just rendered with <code>object-fit: contain</code> instead of <code>cover</code> — nothing here touches the real scanner.
            </p>
            {error && <p style={{ margin: 0, color: "#ff8171", fontSize: 13 }}>{error}</p>}
            <button onClick={() => void start()} style={{ minHeight: 52, borderRadius: 26, border: 0, background: "linear-gradient(180deg,#5b9dff,#1f66e8)", color: "#fff", fontSize: 15, fontWeight: 850 }}>
              Start test camera
            </button>
          </div>
        </div>
      )}

      {running && (
        <div style={{ position: "absolute", left: 12, right: 12, bottom: "max(14px,env(safe-area-inset-bottom))", zIndex: 5, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
          <div style={{ background: "rgba(20,18,24,.72)", backdropFilter: "blur(10px)", borderRadius: 14, padding: "8px 12px", fontSize: 11, lineHeight: 1.5, fontFamily: "ui-monospace, monospace", color: "rgba(255,255,255,.75)" }}>
            {diagnostics ? (
              <>
                <div>{diagnostics.settings.width ?? "?"}×{diagnostics.settings.height ?? "?"} · {diagnostics.settings.facingMode ?? "?"}</div>
                <div>zoom {diagnostics.settings.zoom ?? "n/a"}{diagnostics.capabilities.zoom ? ` (${diagnostics.capabilities.zoom.min ?? "?"}–${diagnostics.capabilities.zoom.max ?? "?"})` : ""}</div>
              </>
            ) : "reading diagnostics…"}
          </div>
          <button onClick={stop} style={{ width: 42, height: 42, borderRadius: "50%", border: 0, background: "rgba(20,18,24,.72)", color: "#fff", fontSize: 18 }} aria-label="Stop">×</button>
        </div>
      )}
    </main>
  );
}
