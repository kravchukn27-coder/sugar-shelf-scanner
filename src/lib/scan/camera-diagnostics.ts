/**
 * A deliberately small, local-only description of the active camera track.
 *
 * This is intended for an on-device diagnostic screen while investigating
 * iPhone camera selection. It never includes frames, image data, OCR, a
 * camera label, or the browser's raw `deviceId`. Callers must not log or send
 * the returned value to a server.
 */
export type CameraDiagnosticSnapshot = {
  source: { deviceIdExposed: boolean; sessionId: string | null };
  settings: {
    width: number | null;
    height: number | null;
    frameRate: number | null;
    aspectRatio: number | null;
    facingMode: string | null;
    zoom: number | null;
  };
  capabilities: {
    torch: boolean;
    zoom: { min: number | null; max: number | null } | null;
  };
  imageCapture: { supported: boolean; takePhoto: boolean };
};

type TrackSettings = {
  deviceId?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  aspectRatio?: number;
  facingMode?: string;
  zoom?: number;
};

type TrackCapabilities = {
  torch?: boolean;
  zoom?: { min?: number; max?: number };
};

type DiagnosticTrack = {
  getSettings?: () => TrackSettings;
  getCapabilities?: () => TrackCapabilities;
};

type ImageCaptureConstructor = { prototype?: { takePhoto?: unknown } };

// This map exists only in memory for the current browser session. Its values,
// not the raw browser identifiers, are safe to show in a diagnostic UI.
const sessionSourceIds = new Map<string, string>();

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sessionSourceId(rawDeviceId: string | undefined): string | null {
  const deviceId = rawDeviceId?.trim();
  if (!deviceId) return null;
  let opaqueId = sessionSourceIds.get(deviceId);
  if (!opaqueId) {
    opaqueId = `camera-${sessionSourceIds.size + 1}`;
    sessionSourceIds.set(deviceId, opaqueId);
  }
  return opaqueId;
}

/** Feature detection only; no still image is captured here. */
export function getImageCaptureSupport(): CameraDiagnosticSnapshot["imageCapture"] {
  const imageCapture = (globalThis as typeof globalThis & { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  return {
    supported: typeof imageCapture === "function",
    takePhoto: typeof imageCapture?.prototype?.takePhoto === "function",
  };
}

/**
 * Snapshot safe metadata from an active video track for local UI presentation.
 * The result is intentionally serializable, but it must remain on-device.
 */
export function getCameraDiagnosticSnapshot(track: MediaStreamTrack | undefined): CameraDiagnosticSnapshot {
  const diagnosticTrack = track as DiagnosticTrack | undefined;
  const settings = diagnosticTrack?.getSettings?.() ?? {};
  const capabilities = diagnosticTrack?.getCapabilities?.() ?? {};
  const zoomMin = finiteNumber(capabilities.zoom?.min);
  const zoomMax = finiteNumber(capabilities.zoom?.max);

  return {
    source: {
      deviceIdExposed: Boolean(settings.deviceId?.trim()),
      sessionId: sessionSourceId(settings.deviceId),
    },
    settings: {
      width: finiteNumber(settings.width),
      height: finiteNumber(settings.height),
      frameRate: finiteNumber(settings.frameRate),
      aspectRatio: finiteNumber(settings.aspectRatio),
      facingMode: typeof settings.facingMode === "string" ? settings.facingMode : null,
      zoom: finiteNumber(settings.zoom),
    },
    capabilities: {
      torch: capabilities.torch === true,
      zoom: zoomMin === null && zoomMax === null ? null : { min: zoomMin, max: zoomMax },
    },
    imageCapture: getImageCaptureSupport(),
  };
}
