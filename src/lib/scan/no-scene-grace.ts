// The first preflight answer lands roughly one scheduler tick plus one Gemini
// round trip after the camera opens — before the user has finished aiming.
// Treating that answer as terminal turns "nothing in frame yet" into a
// blocking prompt the user never had time to read. A negative verdict inside
// this window is discarded and the scheduler keeps looking; the prompt stays
// reachable, it just cannot pre-empt the user's first few seconds.
export const NO_SCENE_GRACE_MS = 4000;

// `liveSince` is null until the camera actually streams. Tapping "start" is
// not that moment: the browser's camera-permission sheet sits in front of the
// scene for as long as the user takes to read it, and time spent behind that
// sheet is not aiming time. Anchoring the window to the tap let the whole
// grace period expire while the user was still deciding to allow the camera,
// so the very first verdict after they allowed it came back terminal.
export type CameraAimingWindow = { readonly liveSince: number | null };

export const requestedCamera = (): CameraAimingWindow => ({ liveSince: null });

export const cameraBecameLive = (window: CameraAimingWindow, now: number): CameraAimingWindow =>
  window.liveSince === null ? { liveSince: now } : window;

export const shouldHoldNoSceneFailure = (window: CameraAimingWindow, now: number, graceMs: number = NO_SCENE_GRACE_MS): boolean =>
  window.liveSince === null || now - window.liveSince < graceMs;
