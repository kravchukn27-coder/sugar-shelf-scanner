/**
 * Canvas camera preview primitives.
 *
 * This deliberately keeps decoded camera pixels in the browser: it only draws
 * an existing HTMLVideoElement into caller-owned canvases. It never captures,
 * serializes, or sends a frame anywhere.
 */
export type CanvasPreviewSize = { width: number; height: number };

export type DrawImageCrop = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export type CanvasBackingSize = CanvasPreviewSize & {
  pixelRatio: number;
};

export type CanvasPreviewTarget = {
  canvas: HTMLCanvasElement;
  /** Maximum refresh rate. The sharp layer normally uses 30; blur 15. */
  fps: number;
  /**
   * Use an already-painted canvas instead of the raw video. The backdrop uses
   * the sharp 3:4 foreground as its source, so it is a blurred enlargement of
   * exactly the same composition rather than a competing camera crop.
   */
  sourceCanvas?: HTMLCanvasElement;
  blurPx?: number;
  brightness?: number;
};

export type CanvasPreviewLoopOptions = {
  video: HTMLVideoElement;
  targets: CanvasPreviewTarget[];
  /** Prevent expensive high-DPR camera backing stores. Defaults to 1.25 MP. */
  maxPixels?: number;
  /** Defaults to two, enough for a crisp preview on current iPhones. */
  maxDevicePixelRatio?: number;
  /** Called only after at least one target has painted a decoded video frame. */
  onFrameDrawn?: () => void;
};

const DEFAULT_MAX_PIXELS = 1_250_000;
const DEFAULT_MAX_DPR = 2;

function usable(size: CanvasPreviewSize) {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

/** Returns the centred source crop required to cover a destination rectangle. */
export function getCoverCrop(source: CanvasPreviewSize, destination: CanvasPreviewSize): DrawImageCrop | null {
  if (!usable(source) || !usable(destination)) return null;

  const sourceAspect = source.width / source.height;
  const destinationAspect = destination.width / destination.height;
  if (sourceAspect > destinationAspect) {
    const sw = source.height * destinationAspect;
    return { sx: (source.width - sw) / 2, sy: 0, sw, sh: source.height };
  }

  const sh = source.width / destinationAspect;
  return { sx: 0, sy: (source.height - sh) / 2, sw: source.width, sh };
}

/**
 * Calculates a canvas backing store which preserves the CSS aspect ratio while
 * bounding both device pixel ratio and total pixels.
 */
export function getCanvasBackingSize(
  cssSize: CanvasPreviewSize,
  devicePixelRatio = 1,
  maxPixels = DEFAULT_MAX_PIXELS,
  maxDevicePixelRatio = DEFAULT_MAX_DPR,
): CanvasBackingSize | null {
  if (!usable(cssSize) || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0
    || !Number.isFinite(maxPixels) || maxPixels <= 0 || !Number.isFinite(maxDevicePixelRatio) || maxDevicePixelRatio <= 0) return null;

  const requestedRatio = Math.min(devicePixelRatio, maxDevicePixelRatio);
  const pixelLimitedRatio = Math.sqrt(maxPixels / (cssSize.width * cssSize.height));
  const pixelRatio = Math.min(requestedRatio, pixelLimitedRatio);
  const width = Math.max(1, Math.round(cssSize.width * pixelRatio));
  const height = Math.max(1, Math.round(cssSize.height * pixelRatio));
  return { width, height, pixelRatio: Math.min(width / cssSize.width, height / cssSize.height) };
}

/** Returns whether a target is eligible to draw at `nowMs`; no browser state needed. */
export function shouldRenderCanvasFrame(lastRenderedAtMs: number | null, nowMs: number, fps: number): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(fps) || fps <= 0) return false;
  return lastRenderedAtMs === null || nowMs - lastRenderedAtMs >= 1000 / fps;
}

/** Draw one centred cover frame. Returns false until the video and canvas are ready. */
export function drawVideoFrameToCanvas(video: HTMLVideoElement, target: CanvasPreviewTarget, options?: {
  maxPixels?: number;
  maxDevicePixelRatio?: number;
  devicePixelRatio?: number;
}): boolean {
  const cssSize = { width: target.canvas.clientWidth, height: target.canvas.clientHeight };
  const crop = getCoverCrop({ width: video.videoWidth, height: video.videoHeight }, cssSize);
  if (!crop) return false;

  const backing = getCanvasBackingSize(
    cssSize,
    options?.devicePixelRatio ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio),
    options?.maxPixels ?? DEFAULT_MAX_PIXELS,
    options?.maxDevicePixelRatio ?? DEFAULT_MAX_DPR,
  );
  if (!backing) return false;
  if (target.canvas.width !== backing.width) target.canvas.width = backing.width;
  if (target.canvas.height !== backing.height) target.canvas.height = backing.height;

  const context = target.canvas.getContext("2d");
  if (!context) return false;
  context.save();
  context.clearRect(0, 0, backing.width, backing.height);
  context.filter = target.blurPx || target.brightness
    ? `blur(${target.blurPx ?? 0}px) brightness(${target.brightness ?? 1})`
    : "none";
  context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, backing.width, backing.height);
  context.restore();
  return true;
}

/** Draw an existing canvas into a target with the same centred cover geometry. */
export function drawCanvasFrameToCanvas(source: HTMLCanvasElement, target: CanvasPreviewTarget, options?: {
  maxPixels?: number;
  maxDevicePixelRatio?: number;
  devicePixelRatio?: number;
}): boolean {
  const cssSize = { width: target.canvas.clientWidth, height: target.canvas.clientHeight };
  const crop = getCoverCrop({ width: source.width, height: source.height }, cssSize);
  if (!crop) return false;
  const backing = getCanvasBackingSize(
    cssSize,
    options?.devicePixelRatio ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio),
    options?.maxPixels ?? DEFAULT_MAX_PIXELS,
    options?.maxDevicePixelRatio ?? DEFAULT_MAX_DPR,
  );
  if (!backing) return false;
  if (target.canvas.width !== backing.width) target.canvas.width = backing.width;
  if (target.canvas.height !== backing.height) target.canvas.height = backing.height;
  const context = target.canvas.getContext("2d");
  if (!context) return false;
  context.save();
  context.clearRect(0, 0, backing.width, backing.height);
  context.filter = target.blurPx || target.brightness
    ? `blur(${target.blurPx ?? 0}px) brightness(${target.brightness ?? 1})`
    : "none";
  context.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, backing.width, backing.height);
  context.restore();
  return true;
}

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

/**
 * Runs a single local render loop for any number of canvases. Keeping both
 * foreground and backdrop on this loop avoids the Safari visual-video layer;
 * every layer reads the same decoded frame from the hidden video element.
 */
export function createCanvasPreviewLoop(options: CanvasPreviewLoopOptions) {
  let running = false;
  let animationFrame: number | null = null;
  const lastDraws = new Map<CanvasPreviewTarget, number>();
  const video = options.video as VideoFrameCallbackVideo;
  const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

  const draw = () => {
    if (!running) return false;
    const time = now();
    let painted = false;
    for (const target of options.targets) {
      if (shouldRenderCanvasFrame(lastDraws.get(target) ?? null, time, target.fps)
        && (target.sourceCanvas
          ? drawCanvasFrameToCanvas(target.sourceCanvas, target, options)
          : drawVideoFrameToCanvas(options.video, target, options))) {
        lastDraws.set(target, time);
        painted = true;
      }
    }
    if (painted) options.onFrameDrawn?.();
    return painted;
  };

  const schedule = () => {
    if (!running) return;
    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(() => { draw(); schedule(); });
    } else {
      animationFrame = requestAnimationFrame(() => { draw(); schedule(); });
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      if (animationFrame !== null && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(animationFrame);
      animationFrame = null;
      lastDraws.clear();
    },
    drawNow: draw,
    get isRunning() { return running; },
  };
}
