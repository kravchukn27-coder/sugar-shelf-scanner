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
  blurPx?: number;
  brightness?: number;
  /** Softens the target's alpha at every edge. Measured in CSS pixels. */
  edgeFeatherPx?: number;
  /** Radius of the feathered target boundary. Measured in CSS pixels. */
  cornerRadiusPx?: number;
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

type CanvasFeatherMask = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  edgeFeatherPx: number;
  cornerRadiusPx: number;
};

const featherMasks = new WeakMap<HTMLCanvasElement, CanvasFeatherMask>();

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

/**
 * Returns the alpha at a point inside a feathered rounded rectangle.
 *
 * Geometry is based on the signed distance to the rounded rectangle, so the
 * transition has the same physical width along straight edges and corners.
 * A smoothstep curve avoids visible bands at either end of the transition.
 */
function roundedRectFeatherAlphaAt(
  x: number,
  y: number,
  width: number,
  height: number,
  edgeFeatherPx: number,
  cornerRadiusPx: number,
) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.min(Math.max(0, cornerRadiusPx), halfWidth, halfHeight);
  const qx = Math.abs(x - halfWidth) - (halfWidth - radius);
  const qy = Math.abs(y - halfHeight) - (halfHeight - radius);
  const outsideDistance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const insideDistance = Math.min(Math.max(qx, qy), 0);
  const signedDistance = outsideDistance + insideDistance - radius;
  const progress = Math.min(1, Math.max(0, -signedDistance / edgeFeatherPx));
  return progress * progress * (3 - 2 * progress);
}

export function getRoundedRectFeatherAlpha(
  point: { x: number; y: number },
  size: CanvasPreviewSize,
  edgeFeatherPx: number,
  cornerRadiusPx = 0,
): number {
  if (!usable(size) || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || !Number.isFinite(edgeFeatherPx) || edgeFeatherPx <= 0
    || !Number.isFinite(cornerRadiusPx)) return 0;
  return roundedRectFeatherAlphaAt(
    point.x,
    point.y,
    size.width,
    size.height,
    edgeFeatherPx,
    cornerRadiusPx,
  );
}

function getFeatherMask(
  targetCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  edgeFeatherPx: number,
  cornerRadiusPx: number,
) {
  const cached = featherMasks.get(targetCanvas);
  if (cached && cached.width === width && cached.height === height
    && cached.edgeFeatherPx === edgeFeatherPx && cached.cornerRadiusPx === cornerRadiusPx) return cached.canvas;

  const ownerDocument = targetCanvas.ownerDocument ?? (typeof document === "undefined" ? null : document);
  if (!ownerDocument) return null;
  const maskCanvas = ownerDocument.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) return null;

  const imageData = maskContext.createImageData(width, height);
  const data = imageData.data;
  data.fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = roundedRectFeatherAlphaAt(
        x + 0.5,
        y + 0.5,
        width,
        height,
        edgeFeatherPx,
        cornerRadiusPx,
      );
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  maskContext.putImageData(imageData, 0, 0);
  featherMasks.set(targetCanvas, { canvas: maskCanvas, width, height, edgeFeatherPx, cornerRadiusPx });
  return maskCanvas;
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

  if (Number.isFinite(target.edgeFeatherPx) && (target.edgeFeatherPx ?? 0) > 0) {
    // The mask describes CSS-pixel geometry, so generating it at the backing
    // store's Retina resolution only repeats the same alpha work. Keep the
    // cached mask at CSS resolution and let drawImage interpolate it once.
    const maskWidth = Math.max(1, Math.round(backing.width / backing.pixelRatio));
    const maskHeight = Math.max(1, Math.round(backing.height / backing.pixelRatio));
    const edgeFeatherPx = target.edgeFeatherPx ?? 0;
    const cornerRadiusPx = Number.isFinite(target.cornerRadiusPx) ? Math.max(0, target.cornerRadiusPx ?? 0) : 0;
    const mask = getFeatherMask(target.canvas, maskWidth, maskHeight, edgeFeatherPx, cornerRadiusPx);
    if (mask) {
      context.save();
      context.globalCompositeOperation = "destination-in";
      context.drawImage(mask, 0, 0, backing.width, backing.height);
      context.restore();
    }
  }
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
        && drawVideoFrameToCanvas(options.video, target, options)) {
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
