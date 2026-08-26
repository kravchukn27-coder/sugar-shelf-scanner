/**
 * The scanner's UI-independent lifecycle. Keeping this state machine pure makes
 * it impossible for a retry/error screen to accidentally keep the camera
 * scheduler running in the background.
 */
export type ScannerLifecycleState =
  | "camera_off"
  | "live_searching"
  | "captured_analyzing"
  | "results"
  | "no_scene"
  | "error";

export type ScannerLifecycleEvent =
  | "START"
  | "CAPTURED"
  | "ANALYZE_SUCCESS"
  | "BARCODE_SUCCESS"
  | "NO_SCENE"
  | "ANALYZE_FAILURE"
  | "RETRY"
  | "CLOSE_CAMERA";

const transitions: Readonly<Record<ScannerLifecycleState, Readonly<Partial<Record<ScannerLifecycleEvent, ScannerLifecycleState>>>>> = {
  camera_off: { START: "live_searching" },
  live_searching: { CAPTURED: "captured_analyzing", NO_SCENE: "no_scene", ANALYZE_FAILURE: "error" },
  captured_analyzing: { ANALYZE_SUCCESS: "results", NO_SCENE: "no_scene", ANALYZE_FAILURE: "error" },
  results: { RETRY: "live_searching" },
  no_scene: { RETRY: "live_searching", BARCODE_SUCCESS: "results" },
  error: { RETRY: "live_searching", BARCODE_SUCCESS: "results" },
};

/**
 * Returns the next scanner state. Events that do not apply in the current
 * state are deliberately ignored, so delayed network callbacks cannot revive
 * a scanner the user has already closed or retried.
 */
export function transitionScannerLifecycle(
  state: ScannerLifecycleState,
  event: ScannerLifecycleEvent,
): ScannerLifecycleState {
  if (event === "CLOSE_CAMERA") return "camera_off";
  return transitions[state][event] ?? state;
}

/** Only the live state may sample and send preflight frames. */
export function shouldRunScannerScheduler(state: ScannerLifecycleState): boolean {
  return state === "live_searching";
}

/** A camera stream should be stopped whenever the scanner is explicitly off. */
export function shouldStopCameraTracks(state: ScannerLifecycleState): boolean {
  return state === "camera_off";
}
