"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyCameraView, getCameraControls, preferCameraCaptureQuality, rearCameraRequest } from "@/lib/scan/media-capabilities";
import { getCameraDiagnosticSnapshot, type CameraDiagnosticSnapshot } from "@/lib/scan/camera-diagnostics";

/**
 * Standalone test route for the "Option 2" viewfinder treatment: cap the
 * video box at a 3:4 aspect ratio (matching what preferCameraCaptureQuality
 * already asks the camera for, applied as a CSS box instead of a hardware
 * constraint Safari ignores) and object-fit: cover within just that box,
 * instead of full-bleed cover on the whole screen. Recovers to ~56% of the
 * frame's horizontal width visible, vs ~42% today.
 *
 * Isolated from the real scanner so it never risks page.tsx. Reuses the same
 * getUserMedia + zoom-constraint code the real scanner uses (rearCameraRequest,
 * preferCameraCaptureQuality, applyCameraView) — only the display CSS differs.
 *
 * Not linked from anywhere in the app; reach it directly at /camera-crop-test.
 */
const BOX_ASPECT = 3 / 4; // width:height
const PROBED_CONSTRAINTS = ["width", "height", "aspectRatio", "resizeMode", "facingMode"] as const;

type ProbedConstraint = (typeof PROBED_CONSTRAINTS)[number];
type ConstraintProbe = { supported: Record<ProbedConstraint, boolean>; requested: string | null };
type ConstraintInspectableTrack = { getConstraints?: () => MediaTrackConstraints };
type LayoutProbe = {
  box: string;
  video: string;
  viewport: string;
  visualViewport: string;
  rawEdges: string;
  objectFit: string;
};

function readConstraintProbe(track?: MediaStreamTrack): ConstraintProbe {
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean | undefined>;
  const requested = (track as ConstraintInspectableTrack | undefined)?.getConstraints?.();
  return {
    supported: Object.fromEntries(PROBED_CONSTRAINTS.map((name) => [name, supported[name] === true])) as Record<ProbedConstraint, boolean>,
    requested: requested ? JSON.stringify(requested) : null,
  };
}

function supportsExactPortrait(probe: ConstraintProbe, includeResizeMode: boolean) {
  return ["width", "height", "aspectRatio", ...(includeResizeMode ? ["resizeMode"] : [])].every((name) => probe.supported[name as ProbedConstraint]);
}

function rectSummary(rect: DOMRect) {
  return `${Math.round(rect.width)}×${Math.round(rect.height)} @ ${Math.round(rect.left)},${Math.round(rect.top)}`;
}

function rawEdgeLuma(video: HTMLVideoElement): string {
  if (!video.videoWidth || !video.videoHeight) return "waiting";
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 36;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "unavailable";
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const averageRows = (from: number, to: number) => {
    let total = 0, count = 0;
    for (let y = from; y < to; y += 1) for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      count += 1;
    }
    return Math.round(total / count);
  };
  return `top:${averageRows(0, 3)} bottom:${averageRows(canvas.height - 3, canvas.height)} / 255`;
}

export default function CameraCropTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<CameraDiagnosticSnapshot | null>(null);
  const [exactResult, setExactResult] = useState<string | null>(null);
  const [constraintProbe, setConstraintProbe] = useState<ConstraintProbe | null>(null);
  const [presentation, setPresentation] = useState<"native" | "cw" | "ccw">("native");
  const [layoutProbe, setLayoutProbe] = useState<LayoutProbe | null>(null);
  // Computed in JS (not via CSS aspect-ratio) so the exact box size in
  // device pixels is verifiable on-screen, not eyeballed from a screenshot.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let w = vw;
      let h = Math.round(w / BOX_ASPECT);
      if (h > vh) { h = vh; w = Math.round(h * BOX_ASPECT); }
      setBox({ w, h });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; }
    setRunning(false);
    setDiagnostics(null);
    setConstraintProbe(null);
    setLayoutProbe(null);
    setPresentation("native");
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
      setConstraintProbe(readConstraintProbe(track));
      setRunning(true);
    } catch {
      setError("Camera unavailable. Check permission and try again.");
    }
  }, []);

  const startExactPortrait = useCallback(async (withCropAndScale = false) => {
    setError(null);
    setExactResult(null);
    const preflightProbe = readConstraintProbe();
    setConstraintProbe(preflightProbe);
    if (!supportsExactPortrait(preflightProbe, withCropAndScale)) {
      const required = ["width", "height", "aspectRatio", ...(withCropAndScale ? ["resizeMode"] : [])] as ProbedConstraint[];
      const missing = required.filter((name) => !preflightProbe.supported[name]).join(", ");
      setExactResult(`NOT TESTABLE — Safari reports unsupported required constraints: ${missing}. Unsupported constraints may be ignored, so this exact request would not be conclusive.`);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          aspectRatio: { exact: 3 / 4 },
          width: { exact: 1440 },
          height: { exact: 1920 },
          ...(withCropAndScale ? { resizeMode: { exact: "crop-and-scale" } } : {}),
        },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (!videoRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const snapshot = getCameraDiagnosticSnapshot(track);
      setDiagnostics(snapshot);
      setConstraintProbe(readConstraintProbe(track));
      const honored = snapshot.settings.width === 1440 && snapshot.settings.height === 1920 && snapshot.settings.aspectRatio !== null && Math.abs(snapshot.settings.aspectRatio - 3 / 4) < 0.002;
      setExactResult(`${honored ? "HONORED" : "NOT HONORED"} — exact ${withCropAndScale ? "portrait + crop-and-scale" : "portrait"} resolved with ${snapshot.settings.width ?? "?"}×${snapshot.settings.height ?? "?"} (ratio ${snapshot.settings.aspectRatio?.toFixed(3) ?? "?"}).`);
      setRunning(true);
    } catch (err) {
      const name = err instanceof Error ? err.name : "UnknownError";
      const message = err instanceof Error ? err.message : String(err);
      const constraint = (err as { constraint?: string })?.constraint;
      setExactResult(`REJECTED — ${name}${constraint ? ` on "${constraint}"` : ""}: ${message || "(no message)"}`);
      setError(null);
    }
  }, []);

  const videoStyle = presentation === "native"
    ? { position: "absolute" as const, inset: 0, width: "100%", height: "100%", objectFit: "cover" as const }
    : {
        position: "absolute" as const,
        left: "50%",
        top: "50%",
        // A 4:3 landscape track should exactly fill this 3:4 box after a
        // 90° rotation. `contain` makes any mismatch visible as bars.
        width: box ? `${box.h}px` : "100svh",
        height: box ? `${box.w}px` : "100vw",
        objectFit: "contain" as const,
        transform: `translate(-50%, -50%) rotate(${presentation === "cw" ? "90deg" : "-90deg"})`,
      };

  useEffect(() => {
    if (!running) return;
    const sample = () => {
      const video = videoRef.current;
      const boxElement = boxRef.current;
      if (!video || !boxElement) return;
      const visualViewport = window.visualViewport;
      setLayoutProbe({
        box: rectSummary(boxElement.getBoundingClientRect()),
        video: rectSummary(video.getBoundingClientRect()),
        viewport: `${window.innerWidth}×${window.innerHeight} dpr:${window.devicePixelRatio}`,
        visualViewport: visualViewport ? `${Math.round(visualViewport.width)}×${Math.round(visualViewport.height)} @ ${Math.round(visualViewport.offsetLeft)},${Math.round(visualViewport.offsetTop)} scale:${visualViewport.scale.toFixed(2)}` : "not exposed",
        rawEdges: rawEdgeLuma(video),
        objectFit: window.getComputedStyle(video).objectFit,
      });
    };
    sample();
    const timer = window.setInterval(sample, 500);
    return () => window.clearInterval(timer);
  }, [running, presentation]);

  useEffect(() => () => stop(), [stop]);

  return (
    <main style={{ minHeight: "100svh", background: "#070708", color: "#fff", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: "max(14px,env(safe-area-inset-top))", left: 0, right: 0, zIndex: 5, display: "flex", justifyContent: "center" }}>
        <span style={{ background: "rgba(20,18,24,.72)", backdropFilter: "blur(10px)", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 700, letterSpacing: ".01em" }}>
          TEST — Option 2: 3:4 box, ~56% of frame visible
        </span>
      </div>

      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div ref={boxRef} style={{ position: "relative", width: box?.w ?? "100%", height: box?.h ?? "75%", background: "#0a0a0c", overflow: "hidden", visibility: running ? "visible" : "hidden" }}>
          <video ref={videoRef} muted playsInline style={videoStyle} />
          {running && (
            <>
              <span aria-hidden="true" style={{ position: "absolute", inset: "12% 5%", border: "1.5px solid rgba(255,255,255,.7)", borderRadius: 16, boxShadow: "0 0 0 1px rgba(0,0,0,.16) inset", pointerEvents: "none" }} />
              <p style={{ position: "absolute", inset: "12% 5%", margin: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "rgba(255,255,255,.6)", fontSize: 15, fontWeight: 700, letterSpacing: ".005em", textShadow: "0 1px 3px rgba(0,0,0,.5)", padding: "0 24px", pointerEvents: "none" }}>
                Scan a product to see how it fits your day
              </p>
            </>
          )}
        </div>
      </div>

      {!running && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div style={{ display: "grid", gap: 16, maxWidth: 320 }}>
            <p style={{ margin: 0, color: "rgba(255,255,255,.7)", fontSize: 14, lineHeight: 1.5 }}>
              Same camera start code as the real scanner (rear camera, zoom forced to 1×). The video box is capped at a <code>3:4</code> aspect and uses <code>object-fit: cover</code> only within it, instead of full-bleed on the whole screen — nothing here touches the real scanner.
            </p>
            {error && <p style={{ margin: 0, color: "#ff8171", fontSize: 13 }}>{error}</p>}
            {exactResult && (
              <p style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 11.5, lineHeight: 1.5, color: exactResult.startsWith("HONORED") ? "#52d18d" : "#ff8171", wordBreak: "break-word" }}>
                {exactResult}
              </p>
            )}
            <button onClick={() => void start()} style={{ minHeight: 52, borderRadius: 26, border: 0, background: "linear-gradient(180deg,#5b9dff,#1f66e8)", color: "#fff", fontSize: 15, fontWeight: 850 }}>
              Start test camera (native presentation)
            </button>
            <button onClick={() => void startExactPortrait()} style={{ minHeight: 52, borderRadius: 26, border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "#fff", fontSize: 14, fontWeight: 700 }}>
              Test exact portrait request
            </button>
            <button onClick={() => void startExactPortrait(true)} style={{ minHeight: 52, borderRadius: 26, border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "#fff", fontSize: 14, fontWeight: 700 }}>
              Test exact portrait + crop-and-scale
            </button>
          </div>
        </div>
      )}

      {running && (
        <div style={{ position: "absolute", left: 12, right: 12, bottom: "max(14px,env(safe-area-inset-bottom))", zIndex: 5, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
          <div style={{ background: "rgba(20,18,24,.72)", backdropFilter: "blur(10px)", borderRadius: 14, padding: "8px 12px", fontSize: 11, lineHeight: 1.5, fontFamily: "ui-monospace, monospace", color: "rgba(255,255,255,.75)" }}>
            {diagnostics ? (
              <>
                <div>stream {diagnostics.settings.width ?? "?"}×{diagnostics.settings.height ?? "?"} · {diagnostics.settings.facingMode ?? "?"}</div>
                <div>zoom {diagnostics.settings.zoom ?? "n/a"}{diagnostics.capabilities.zoom ? ` (${diagnostics.capabilities.zoom.min ?? "?"}–${diagnostics.capabilities.zoom.max ?? "?"})` : ""}</div>
                <div>box {box ? `${box.w}×${box.h} (${(box.w / box.h).toFixed(3)})` : "?"} · viewport {typeof window !== "undefined" ? `${window.innerWidth}×${window.innerHeight}` : "?"}</div>
                <div>supported {constraintProbe ? PROBED_CONSTRAINTS.map((name) => `${name}:${constraintProbe.supported[name] ? "yes" : "no"}`).join(" · ") : "reading…"}</div>
                {constraintProbe?.requested && <div style={{ maxWidth: 270, overflowWrap: "anywhere" }}>requested {constraintProbe.requested}</div>}
                {layoutProbe && <>
                  <div>CSS box {layoutProbe.box} · video {layoutProbe.video} · fit:{layoutProbe.objectFit}</div>
                  <div>layout viewport {layoutProbe.viewport} · visual {layoutProbe.visualViewport}</div>
                  <div>raw frame edges {layoutProbe.rawEdges}</div>
                </>}
              </>
            ) : "reading diagnostics…"}
          </div>
          <div style={{ display: "grid", gap: 7, justifyItems: "end" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setPresentation("native")} style={{ minHeight: 32, borderRadius: 16, border: 0, padding: "0 10px", background: presentation === "native" ? "#fff" : "rgba(20,18,24,.72)", color: presentation === "native" ? "#17141d" : "#fff", fontSize: 11, fontWeight: 750 }}>Native</button>
              <button onClick={() => setPresentation("cw")} style={{ minHeight: 32, borderRadius: 16, border: 0, padding: "0 10px", background: presentation === "cw" ? "#fff" : "rgba(20,18,24,.72)", color: presentation === "cw" ? "#17141d" : "#fff", fontSize: 11, fontWeight: 750 }}>↻ 90°</button>
              <button onClick={() => setPresentation("ccw")} style={{ minHeight: 32, borderRadius: 16, border: 0, padding: "0 10px", background: presentation === "ccw" ? "#fff" : "rgba(20,18,24,.72)", color: presentation === "ccw" ? "#17141d" : "#fff", fontSize: 11, fontWeight: 750 }}>↺ 90°</button>
            </div>
            <button onClick={stop} style={{ width: 42, height: 42, borderRadius: "50%", border: 0, background: "rgba(20,18,24,.72)", color: "#fff", fontSize: 18 }} aria-label="Stop">×</button>
          </div>
        </div>
      )}
    </main>
  );
}
