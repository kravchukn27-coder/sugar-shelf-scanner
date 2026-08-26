/**
 * Cheap, aggregate-only quality checks for a downscaled live-camera frame.
 *
 * This module deliberately accepts pixels rather than a canvas/video element so
 * it remains browser-independent and cannot retain or log the source frame.
 * Callers should pass a small (for example 32x24) RGBA sample.
 */

export const FRAME_QUALITY_DEFAULTS = {
  minMeanLuma: 28,
  maxMeanLuma: 238,
  maxClippedPixelRatio: 0.72,
  minSharpness: 3,
} as const;

/** Bounded escape hatch for dark or low-texture products that are still valid. */
export const QUALITY_SKIP_FALLBACK_AFTER = 3;

export type FrameQualityOptions = Partial<{
  minMeanLuma: number;
  maxMeanLuma: number;
  maxClippedPixelRatio: number;
  minSharpness: number;
}>;

export interface FrameQuality {
  meanLuma: number;
  darkPixelRatio: number;
  brightPixelRatio: number;
  clippedPixelRatio: number;
  sharpness: number;
  tooDark: boolean;
  tooBright: boolean;
  tooClipped: boolean;
  tooBlurry: boolean;
  shouldSkip: boolean;
}

const DARK_PIXEL_LIMIT = 16;
const BRIGHT_PIXEL_LIMIT = 245;

function assertDimensions(dataLength: number, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Frame dimensions must be positive integers");
  }
  if (dataLength !== width * height * 4) {
    throw new RangeError("RGBA data length does not match frame dimensions");
  }
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Convert an RGBA sample to luma. Alpha is intentionally ignored. */
export function rgbaToLuma(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  assertDimensions(data.length, width, height);
  const luma = new Uint8ClampedArray(width * height);
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 4;
    luma[index] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
  }
  return luma;
}

/** Mean absolute local luma gradient; flat/soft frames score near zero. */
export function measureSharpness(luma: Uint8ClampedArray, width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || luma.length !== width * height) {
    throw new RangeError("Luma data length does not match frame dimensions");
  }
  if (width === 1 && height === 1) return 0;

  let total = 0;
  let comparisons = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x + 1 < width) {
        total += Math.abs(luma[index] - luma[index + 1]);
        comparisons += 1;
      }
      if (y + 1 < height) {
        total += Math.abs(luma[index] - luma[index + width]);
        comparisons += 1;
      }
    }
  }
  return comparisons === 0 ? 0 : total / comparisons;
}

/**
 * Calculate quality signals for one downscaled RGBA sample.
 * `shouldSkip` is advisory: callers should simply wait for the next live tick.
 */
export function sampleFrameQuality(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: FrameQualityOptions = {},
): FrameQuality {
  const luma = rgbaToLuma(data, width, height);
  const thresholds = { ...FRAME_QUALITY_DEFAULTS, ...options };
  let totalLuma = 0;
  let darkPixels = 0;
  let brightPixels = 0;

  for (const value of luma) {
    totalLuma += value;
    if (value <= DARK_PIXEL_LIMIT) darkPixels += 1;
    if (value >= BRIGHT_PIXEL_LIMIT) brightPixels += 1;
  }

  const pixelCount = luma.length;
  const meanLuma = totalLuma / pixelCount;
  const darkPixelRatio = clampRatio(darkPixels / pixelCount);
  const brightPixelRatio = clampRatio(brightPixels / pixelCount);
  const clippedPixelRatio = darkPixelRatio + brightPixelRatio;
  const sharpness = measureSharpness(luma, width, height);
  const tooDark = meanLuma < thresholds.minMeanLuma;
  const tooBright = meanLuma > thresholds.maxMeanLuma;
  const tooClipped = clippedPixelRatio > thresholds.maxClippedPixelRatio;
  const tooBlurry = sharpness < thresholds.minSharpness;

  return {
    meanLuma,
    darkPixelRatio,
    brightPixelRatio,
    clippedPixelRatio,
    sharpness,
    tooDark,
    tooBright,
    tooClipped,
    tooBlurry,
    shouldSkip: tooDark || tooBright || tooClipped || tooBlurry,
  };
}

export const isFrameTooDark = (quality: FrameQuality): boolean => quality.tooDark;
export const isFrameTooBright = (quality: FrameQuality): boolean => quality.tooBright;
export const isFrameTooBlurry = (quality: FrameQuality): boolean => quality.tooBlurry;

/** Keep this as a named policy boundary for the live scheduler. */
export function shouldSkipPreflight(quality: FrameQuality): boolean {
  return quality.shouldSkip;
}

export function shouldBypassQualityAfterSkips(consecutiveSkips: number): boolean {
  return consecutiveSkips >= QUALITY_SKIP_FALLBACK_AFTER;
}
