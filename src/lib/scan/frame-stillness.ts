// Mean-abs-diff on a 0-255 luma scale; 14 tolerates sensor noise/compression
// dither plus ordinary handheld tremor on a static scene while still catching
// a hand or product actually moving. Raised from 10 once the threshold
// benchmark showed Gemini handles mild motion blur fine, so blocking on it
// locally was mostly costing responsiveness rather than saving bad requests.
export const STILLNESS_THRESHOLD = 14;

export function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

export function sampleLuma(ctx: CanvasRenderingContext2D, width: number, height: number): Uint8ClampedArray {
  const { data } = ctx.getImageData(0, 0, width, height);
  const luma = new Uint8ClampedArray(width * height);
  for (let i = 0; i < luma.length; i++) {
    const o = i * 4;
    luma[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  return luma;
}

export const isFrameMoving = (previous: Uint8ClampedArray, current: Uint8ClampedArray) => frameDiff(previous, current) > STILLNESS_THRESHOLD;
