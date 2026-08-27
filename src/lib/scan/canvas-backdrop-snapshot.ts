/**
 * A locally held, immutable copy of a rendered canvas backdrop.
 *
 * The snapshot is a data URL, not a Blob URL: it therefore has no browser
 * resource that needs explicit revocation and it never leaves the page. Callers
 * release it by replacing their state/ref with `null` once the scan view closes.
 */
export type CanvasBackdropSnapshot = Readonly<{
  /** A browser-local JPEG data URL suitable for an <img src> or CSS background. */
  dataUrl: string;
  width: number;
  height: number;
}>;

export type SnapshotCanvas = Pick<HTMLCanvasElement, "width" | "height" | "toDataURL">;

const DEFAULT_QUALITY = 0.82;

function isUsableCanvas(canvas: SnapshotCanvas | null | undefined): canvas is SnapshotCanvas {
  if (!canvas) return false;
  return Number.isFinite(canvas.width)
    && Number.isFinite(canvas.height)
    && canvas.width > 0
    && canvas.height > 0;
}

/**
 * Captures the canvas as a self-contained local JPEG. It returns null when the
 * canvas is not ready or the browser rejects serialization (for example, a
 * tainted canvas). No exception is allowed to interrupt camera capture.
 */
export function captureCanvasBackdropSnapshot(
  canvas: SnapshotCanvas | null | undefined,
  quality = DEFAULT_QUALITY,
): CanvasBackdropSnapshot | null {
  if (!isUsableCanvas(canvas) || !Number.isFinite(quality)) return null;

  try {
    const dataUrl = canvas.toDataURL("image/jpeg", Math.min(1, Math.max(0, quality)));
    if (!dataUrl.startsWith("data:image/jpeg")) return null;
    return Object.freeze({ dataUrl, width: canvas.width, height: canvas.height });
  } catch {
    return null;
  }
}

/**
 * Explicitly documents the release point for callers: set React state/ref to
 * this return value when leaving the frozen scan. Data URLs have no revoke API;
 * removing the last reference makes them eligible for garbage collection.
 */
export function releaseCanvasBackdropSnapshot(): null {
  return null;
}
