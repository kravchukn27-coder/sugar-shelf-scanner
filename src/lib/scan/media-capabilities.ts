/**
 * Browser camera capabilities are optional and vary substantially on iPhone.
 * These helpers describe a field of view, never a physical lens: Safari may
 * select wide or ultra-wide hardware for the same requested zoom.
 */
export type CameraTrackCapabilities = { torch?: boolean; zoom?: { min?: number; max?: number } };
type CapabilityTrack = { getCapabilities?: () => CameraTrackCapabilities; applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void> };
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
 * Ask for the rear stream at 1× from the first camera negotiation. Applying
 * zoom only after a stream starts is too late on some iPhone/Safari camera
 * stacks: Safari may already have selected an ultra-wide/macro field of view.
 * This stays an ideal preference—the browser remains free to ignore an
 * unsupported zoom constraint, and later capability checks keep the UI safe.
 */
export function rearCameraRequest(): MediaStreamConstraints {
  return {
    // TypeScript's bundled DOM declarations lag this optional browser
    // constraint, even though we already feature-detect it after startup.
    video: {
      facingMode: { ideal: "environment" },
      zoom: { ideal: 1 },
      width: { ideal: 1280 },
      height: { ideal: 1920 },
    } as MediaTrackConstraints,
    audio: false,
  };
}
