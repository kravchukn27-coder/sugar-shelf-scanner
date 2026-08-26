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
export type CameraControls = { torchAvailable: boolean; standardZoom: number | null; closerZoom: number | null };
export type CameraView = "standard" | "closer";

export function getCameraControls(track: MediaStreamTrack | undefined): CameraControls {
  const capabilities = (track as CapabilityTrack | undefined)?.getCapabilities?.();
  const min = capabilities?.zoom?.min, max = capabilities?.zoom?.max;
  const hasZoomRange = Number.isFinite(min) && Number.isFinite(max) && (min as number) <= (max as number);
  const standardZoom = hasZoomRange && (min as number) <= 1 && (max as number) >= 1 ? 1 : null;
  // The scanner's user-facing control is deliberately a closer 2× view, not
  // an ultra-wide 0.5× view. Do not expose a misleading button on devices
  // that cannot actually provide a useful close view.
  const closerZoom = standardZoom !== null && (max as number) >= 2 ? 2 : null;
  return { torchAvailable: capabilities?.torch === true, standardZoom, closerZoom };
}

export function supportsTorch(track: MediaStreamTrack | undefined): boolean { return getCameraControls(track).torchAvailable; }

/** Apply a reported zoom value only; unsupported controls remain inert. */
export async function applyCameraView(track: MediaStreamTrack | undefined, controls: CameraControls, view: CameraView): Promise<boolean> {
  const zoom = view === "closer" ? controls.closerZoom : controls.standardZoom;
  const applyConstraints = (track as CapabilityTrack | undefined)?.applyConstraints;
  if (zoom === null || !applyConstraints) return false;
  await applyConstraints.call(track, { advanced: [{ zoom } as MediaTrackConstraintSet] });
  return true;
}

/**
 * Prefer a sharper portrait video mode only after Safari has selected a rear
 * source. This is a quality preference, never a camera/lens selector, and a
 * browser may keep its current mode when the request cannot be satisfied.
 */
export async function preferCameraCaptureQuality(track: MediaStreamTrack | undefined): Promise<boolean> {
  const applyConstraints = (track as CapabilityTrack | undefined)?.applyConstraints;
  if (!applyConstraints) return false;
  await applyConstraints.call(track, {
    width: { ideal: 1440 },
    height: { ideal: 1920 },
    aspectRatio: { ideal: 3 / 4 },
  });
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
