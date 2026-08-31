/**
 * Turns a getUserMedia rejection into copy the user can act on.
 *
 * The error's `name` is the authoritative signal at the moment of failure and
 * is available in every browser we target. The Permissions API is not used
 * here: Safari does not expose a `camera` entry, so it would tell us nothing
 * exactly where this matters most.
 */
export type CameraAccessFailure = {
  /** First line is the heading; the rest becomes the prompt's description. */
  message: string;
  /**
   * Whether offering a retry button makes sense. A blocked permission still
   * gets one — the browser will not re-prompt, but the user can allow the
   * camera in settings and come back. A device with no camera gets none:
   * nothing the user does here changes the answer, so the copy sends them to
   * the gallery instead.
   */
  canRetry: boolean;
};

const BLOCKED: CameraAccessFailure = {
  message: "Camera access is off\nAllow the camera for this site in your browser settings, then try again.",
  canRetry: true,
};

const NO_CAMERA: CameraAccessFailure = {
  message: "No camera available\nThis device doesn’t expose a camera to the browser. You can still pick a photo from your gallery.",
  canRetry: false,
};

const BUSY: CameraAccessFailure = {
  message: "Camera is in use\nClose other apps or tabs using the camera, then try again.",
  canRetry: true,
};

const UNKNOWN: CameraAccessFailure = {
  message: "Camera unavailable. Check permission and try again.",
  canRetry: true,
};

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

export function describeCameraAccessFailure(error: unknown): CameraAccessFailure {
  switch (errorName(error)) {
    // SecurityError is what a blocked permission looks like on older WebKit.
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return BLOCKED;
    // OverconstrainedError here means no device matched even the rear-camera
    // fallback, which the user experiences as "there is no camera".
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return NO_CAMERA;
    // The hardware exists but another app or tab holds it.
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return BUSY;
    default:
      return UNKNOWN;
  }
}
