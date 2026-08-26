/**
 * Browser camera capabilities are optional and vary substantially on iPhone.
 * These helpers describe a field of view, never a physical lens: Safari may
 * select wide or ultra-wide hardware for the same requested zoom.
 */
export type CameraTrackCapabilities = { torch?: boolean; zoom?: { min?: number; max?: number } };
type CameraTrackSettings = { deviceId?: string };
type CapabilityTrack = {
  getCapabilities?: () => CameraTrackCapabilities;
  getSettings?: () => CameraTrackSettings;
  applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
};
export type CameraControls = { torchAvailable: boolean; standardZoom: number | null; wideZoom: number | null };
export type CameraView = "standard" | "wide";

export function getCameraControls(track: MediaStreamTrack | undefined): CameraControls {
  const capabilities = (track as CapabilityTrack | undefined)?.getCapabilities?.();
  const min = capabilities?.zoom?.min, max = capabilities?.zoom?.max;
  const hasZoomRange = Number.isFinite(min) && Number.isFinite(max) && (min as number) <= (max as number);
  const standardZoom = hasZoomRange && (min as number) <= 1 && (max as number) >= 1 ? 1 : null;
  const wideZoom = standardZoom !== null && (min as number) < standardZoom ? min as number : null;
  return { torchAvailable: capabilities?.torch === true, standardZoom, wideZoom };
}

export function supportsTorch(track: MediaStreamTrack | undefined): boolean { return getCameraControls(track).torchAvailable; }

/** Apply a reported zoom value only; unsupported controls remain inert. */
export async function applyCameraView(track: MediaStreamTrack | undefined, controls: CameraControls, view: CameraView): Promise<boolean> {
  const zoom = view === "wide" ? controls.wideZoom : controls.standardZoom;
  const applyConstraints = (track as CapabilityTrack | undefined)?.applyConstraints;
  if (zoom === null || !applyConstraints) return false;
  await applyConstraints.call(track, { advanced: [{ zoom } as MediaTrackConstraintSet] });
  return true;
}

/**
 * Return the source identifier currently selected by the browser, if exposed.
 * Supplying it to a later getUserMedia call is the only standards-based way to
 * ask for that same source again. `facingMode` identifies a direction, not a
 * particular rear lens, and a zoom constraint does not identify one either.
 */
export function getCameraDeviceId(track: MediaStreamTrack | undefined): string | null {
  const deviceId = (track as CapabilityTrack | undefined)?.getSettings?.().deviceId?.trim();
  return deviceId || null;
}

/**
 * Request the same rear source on a retry when a prior track identified it.
 * On the first request, keep the profile deliberately narrow: constraints such
 * as ideal zoom and a capture resolution participate in browser source/mode
 * selection but cannot guarantee a physical iPhone lens. Standard 1× is
 * applied only after capability inspection, on the selected track.
 */
export function rearCameraRequest(preferredDeviceId?: string | null): MediaStreamConstraints {
  const deviceId = preferredDeviceId?.trim();
  return {
    video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } },
    audio: false,
  };
}
