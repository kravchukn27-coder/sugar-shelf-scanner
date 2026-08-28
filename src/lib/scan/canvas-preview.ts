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
  /**
   * Draw at the same source-to-CSS scale as this element's box instead of this
   * target's own cover crop. A backdrop then reads as the blurred continuation
   * of the viewfinder rather than an enlarged second crop of it. Where the
   * continuation runs past the source, the nearest edge pixels are stretched.
   */
  continuationOf?: HTMLElement | null;
};

export type CanvasPreviewSource = {
  image: CanvasImageSource;
  width: number;
  height: number;
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
 * Returns the centred source crop that fills `destination` at the very same
 * source-to-CSS scale `reference` is drawn at.
 *
 * `reference` is the viewfinder: it shows a cover crop of the source, which
 * fixes one scale. Reusing that scale for a larger destination means the crop
 * has to grow, and it can grow past the source — a portrait viewfinder over a
 * landscape camera has no more rows to give. The returned rectangle is
 * therefore allowed to fall outside the source; the caller decides how to fill
 * what is missing.
 */
export function getContinuationCrop(
  source: CanvasPreviewSize,
  reference: CanvasPreviewSize,
  destination: CanvasPreviewSize,
): DrawImageCrop | null {
  const referenceCrop = getCoverCrop(source, reference);
  if (!referenceCrop || !usable(destination) || referenceCrop.sw <= 0) return null;

  const scale = reference.width / referenceCrop.sw;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const sw = destination.width / scale;
  const sh = destination.height / scale;
  return { sx: (source.width - sw) / 2, sy: (source.height - sh) / 2, sw, sh };
}

/**
 * Fills one corner gap of the clamped-edge backdrop.
 *
 * There is no real source data past the frame's own edges: at the true
 * corner, the row (top/bottom) strip's own nearest-edge clamp and the
 * column (left/right) strip's own nearest-edge clamp settle on the exact
 * same source pixel. A "diagonal blend between the two edges" therefore has
 * no genuinely different samples to blend — it degenerates back to the same
 * flat value. What actually reads as a seam is geometric, not chromatic: the
 * corner is a single flat rectangle sitting right next to two strips that
 * visibly vary, so the eye catches the *hard cut* from "gradient" to "flat"
 * at the corner boundary, especially against the sharp rounded-corner
 * viewfinder drawn on top.
 *
 * The fix softens that cut instead of fabricating content: each neighboring
 * strip's own clamped mapping is extended a few pixels into the corner,
 * alpha-fading from faint at the far corner point up to fully opaque right
 * at the strip's real boundary. Every extension sample still clamps to the
 * strip's own edge line — nothing new is invented — but the transition into
 * the flat fill happens gradually instead of at a hard rectangular edge.
 */
type CornerGapSpec = {
  /** Source neighborhood for the flat base fill (a couple of pixels wide/tall rather than one exact pixel). */
  baseSampleX: number;
  baseSampleY: number;
  baseSampleWidth: number;
  baseSampleHeight: number;
  /** Row (top/bottom) strip: source y of its edge line, and the source x its own clamp settles on across this whole corner. */
  rowSourceY: number;
  rowClampX: number;
  /** True when the row strip's real region sits at this corner's right edge (feather zone hugs that edge, fading out leftward); false when it sits at the left edge. */
  rowBoundaryAtRight: boolean;
  /** Column (left/right) strip: source x of its edge line, and the source y its own clamp settles on across this whole corner. */
  colSourceX: number;
  colClampY: number;
  /** True when the column strip's real region sits at this corner's bottom edge; false when it sits at the top edge. */
  colBoundaryAtBottom: boolean;
};

/** How far into the corner each strip's feathered extension reaches, in destination pixels. */
const CORNER_FEATHER_PX = 12;
/** Thin alpha steps rather than a real gradient — cheap, and the result only needs to look smooth after the blur already applied to the whole draw. */
const CORNER_FEATHER_SLICES = 4;

function drawCornerGap(
  context: CanvasRenderingContext2D,
  source: CanvasPreviewSource,
  spec: CornerGapSpec,
  destX: number,
  destY: number,
  destWidth: number,
  destHeight: number,
): void {
  if (destWidth <= 0 || destHeight <= 0) return;

  // The flat base fill, exactly as before but sampling a small neighborhood
  // instead of one exact pixel.
  context.drawImage(
    source.image,
    spec.baseSampleX, spec.baseSampleY, spec.baseSampleWidth, spec.baseSampleHeight,
    destX, destY, destWidth, destHeight,
  );

  context.save();

  // Feather the seam against the row (top/bottom) strip.
  const rowFeatherWidth = Math.min(destWidth, CORNER_FEATHER_PX);
  if (rowFeatherWidth > 0) {
    const zoneStart = spec.rowBoundaryAtRight ? destX + destWidth - rowFeatherWidth : destX;
    for (let i = 0; i < CORNER_FEATHER_SLICES; i += 1) {
      const t0 = i / CORNER_FEATHER_SLICES;
      const t1 = (i + 1) / CORNER_FEATHER_SLICES;
      const sliceX = zoneStart + t0 * rowFeatherWidth;
      const sliceWidth = (t1 - t0) * rowFeatherWidth;
      const proximityToStrip = spec.rowBoundaryAtRight ? (t0 + t1) / 2 : 1 - (t0 + t1) / 2;
      context.globalAlpha = proximityToStrip;
      context.drawImage(source.image, spec.rowClampX, spec.rowSourceY, 1, 1, sliceX, destY, sliceWidth, destHeight);
    }
  }

  // Feather the seam against the column (left/right) strip.
  const colFeatherHeight = Math.min(destHeight, CORNER_FEATHER_PX);
  if (colFeatherHeight > 0) {
    const zoneStart = spec.colBoundaryAtBottom ? destY + destHeight - colFeatherHeight : destY;
    for (let i = 0; i < CORNER_FEATHER_SLICES; i += 1) {
      const t0 = i / CORNER_FEATHER_SLICES;
      const t1 = (i + 1) / CORNER_FEATHER_SLICES;
      const sliceY = zoneStart + t0 * colFeatherHeight;
      const sliceHeight = (t1 - t0) * colFeatherHeight;
      const proximityToStrip = spec.colBoundaryAtBottom ? (t0 + t1) / 2 : 1 - (t0 + t1) / 2;
      context.globalAlpha = proximityToStrip;
      context.drawImage(source.image, spec.colSourceX, spec.colClampY, 1, 1, destX, sliceY, destWidth, sliceHeight);
    }
  }

  context.restore();
}

/**
 * Draws `crop` of `source` across the whole destination, clamping to the
 * source edges. A crop reaching past the source is drawn where it exists and
 * the adjacent edge line is stretched into the remainder, which under the
 * backdrop's blur reads as the picture simply continuing.
 */
export function drawCropClampedToEdge(
  context: CanvasRenderingContext2D,
  source: CanvasPreviewSource,
  crop: DrawImageCrop,
  destinationWidth: number,
  destinationHeight: number,
): boolean {
  if (crop.sw <= 0 || crop.sh <= 0) return false;
  const scaleX = destinationWidth / crop.sw;
  const scaleY = destinationHeight / crop.sh;

  const left = Math.max(0, crop.sx);
  const top = Math.max(0, crop.sy);
  const right = Math.min(source.width, crop.sx + crop.sw);
  const bottom = Math.min(source.height, crop.sy + crop.sh);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return false;

  const dx = (left - crop.sx) * scaleX;
  const dy = (top - crop.sy) * scaleY;
  const dw = width * scaleX;
  const dh = height * scaleY;
  context.drawImage(source.image, left, top, width, height, dx, dy, dw, dh);

  // One-pixel edge lines stretched into whatever the crop could not reach.
  const gapTop = dy;
  const gapLeft = dx;
  const gapBottom = destinationHeight - (dy + dh);
  const gapRight = destinationWidth - (dx + dw);
  if (gapTop > 0) context.drawImage(source.image, left, top, width, 1, dx, 0, dw, gapTop);
  if (gapBottom > 0) context.drawImage(source.image, left, bottom - 1, width, 1, dx, dy + dh, dw, gapBottom);
  if (gapLeft > 0) context.drawImage(source.image, left, top, 1, height, 0, dy, gapLeft, dh);
  if (gapRight > 0) context.drawImage(source.image, right - 1, top, 1, height, dx + dw, dy, gapRight, dh);
  const baseW = Math.min(2, width);
  const baseH = Math.min(2, height);
  if (gapTop > 0 && gapLeft > 0) {
    drawCornerGap(context, source, {
      baseSampleX: left, baseSampleY: top, baseSampleWidth: baseW, baseSampleHeight: baseH,
      rowSourceY: top, rowClampX: left, rowBoundaryAtRight: true,
      colSourceX: left, colClampY: top, colBoundaryAtBottom: true,
    }, 0, 0, gapLeft, gapTop);
  }
  if (gapTop > 0 && gapRight > 0) {
    drawCornerGap(context, source, {
      baseSampleX: Math.max(left, right - baseW), baseSampleY: top, baseSampleWidth: baseW, baseSampleHeight: baseH,
      rowSourceY: top, rowClampX: right - 1, rowBoundaryAtRight: false,
      colSourceX: right - 1, colClampY: top, colBoundaryAtBottom: true,
    }, dx + dw, 0, gapRight, gapTop);
  }
  if (gapBottom > 0 && gapLeft > 0) {
    drawCornerGap(context, source, {
      baseSampleX: left, baseSampleY: Math.max(top, bottom - baseH), baseSampleWidth: baseW, baseSampleHeight: baseH,
      rowSourceY: bottom - 1, rowClampX: left, rowBoundaryAtRight: true,
      colSourceX: left, colClampY: bottom - 1, colBoundaryAtBottom: false,
    }, 0, dy + dh, gapLeft, gapBottom);
  }
  if (gapBottom > 0 && gapRight > 0) {
    drawCornerGap(context, source, {
      baseSampleX: Math.max(left, right - baseW), baseSampleY: Math.max(top, bottom - baseH), baseSampleWidth: baseW, baseSampleHeight: baseH,
      rowSourceY: bottom - 1, rowClampX: right - 1, rowBoundaryAtRight: false,
      colSourceX: right - 1, colClampY: bottom - 1, colBoundaryAtBottom: false,
    }, dx + dw, dy + dh, gapRight, gapBottom);
  }
  return true;
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
  return drawSourceToCanvas({ image: video, width: video.videoWidth, height: video.videoHeight }, target, options);
}

/** Draw one frame from any decoded source. Returns false until it and the canvas are ready. */
export function drawSourceToCanvas(source: CanvasPreviewSource, target: CanvasPreviewTarget, options?: {
  maxPixels?: number;
  maxDevicePixelRatio?: number;
  devicePixelRatio?: number;
}): boolean {
  const cssSize = { width: target.canvas.clientWidth, height: target.canvas.clientHeight };
  const sourceSize = { width: source.width, height: source.height };
  const reference = target.continuationOf
    ? { width: target.continuationOf.clientWidth, height: target.continuationOf.clientHeight }
    : null;
  const crop = reference && usable(reference)
    ? getContinuationCrop(sourceSize, reference, cssSize)
    : getCoverCrop(sourceSize, cssSize);
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
  const drawn = drawCropClampedToEdge(context, source, crop, backing.width, backing.height);
  context.restore();
  if (!drawn) return false;

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
