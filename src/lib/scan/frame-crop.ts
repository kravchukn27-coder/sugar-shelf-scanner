import type { NormalizedBox } from "@/lib/contracts/product";

export type SourceFrameCrop = {
  aspect: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export type ObjectFitCoverTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  renderedWidth: number;
  renderedHeight: number;
};

type FrameSize = {
  width: number;
  height: number;
};

const isUsableSize = ({ width, height }: FrameSize) =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

/**
 * Describes the same centred `object-fit: cover` transform browsers use for a
 * source image inside a preview. Keeping it explicit lets an analysis crop and
 * the rendered upload share one coordinate system without reading DOM state.
 */
export function getObjectFitCoverTransform(source: FrameSize, preview: FrameSize): ObjectFitCoverTransform | null {
  if (!isUsableSize(source) || !isUsableSize(preview)) return null;

  const scale = Math.max(preview.width / source.width, preview.height / source.height);
  const renderedWidth = source.width * scale;
  const renderedHeight = source.height * scale;
  return {
    scale,
    renderedWidth,
    renderedHeight,
    offsetX: (preview.width - renderedWidth) / 2,
    offsetY: (preview.height - renderedHeight) / 2,
  };
}

/**
 * Gemini boxes are normalized to the exact image crop sent for analysis, while
 * overlays are drawn over the original upload with `object-fit: cover`. This
 * maps a Gemini box through that crop and into normalized preview coordinates.
 * A box clipped fully outside the visible preview returns null; partial boxes
 * are clipped so the result remains valid for `normalizedBoxSchema`.
 */
export function mapAnalyzedBoxToPreview(
  box: NormalizedBox,
  analyzedCrop: SourceFrameCrop,
  source: FrameSize,
  preview: FrameSize,
): NormalizedBox | null {
  const transform = getObjectFitCoverTransform(source, preview);
  if (!transform || !Number.isFinite(analyzedCrop.sx) || !Number.isFinite(analyzedCrop.sy)
    || !Number.isFinite(analyzedCrop.sw) || !Number.isFinite(analyzedCrop.sh)
    || analyzedCrop.sw <= 0 || analyzedCrop.sh <= 0) return null;

  const left = (analyzedCrop.sx + box.x * analyzedCrop.sw) * transform.scale + transform.offsetX;
  const top = (analyzedCrop.sy + box.y * analyzedCrop.sh) * transform.scale + transform.offsetY;
  const right = (analyzedCrop.sx + (box.x + box.width) * analyzedCrop.sw) * transform.scale + transform.offsetX;
  const bottom = (analyzedCrop.sy + (box.y + box.height) * analyzedCrop.sh) * transform.scale + transform.offsetY;

  const clippedLeft = Math.max(0, Math.min(preview.width, left));
  const clippedTop = Math.max(0, Math.min(preview.height, top));
  const clippedRight = Math.max(0, Math.min(preview.width, right));
  const clippedBottom = Math.max(0, Math.min(preview.height, bottom));
  if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null;

  return {
    x: clippedLeft / preview.width,
    y: clippedTop / preview.height,
    width: (clippedRight - clippedLeft) / preview.width,
    height: (clippedBottom - clippedTop) / preview.height,
  };
}

/**
 * Produces a centred crop matching the visible preview. A detached uploaded
 * Image has no layout box, so its natural aspect ratio is the safe fallback.
 * `zoom` is digital only: it never changes a camera track or the live view.
 */
export function getCenteredFrameCrop(
  sourceWidth: number,
  sourceHeight: number,
  previewWidth: number,
  previewHeight: number,
  zoom = 1,
): SourceFrameCrop | null {
  if (!sourceWidth || !sourceHeight) return null;

  const hasPreview = previewWidth > 0 && previewHeight > 0;
  const aspect = hasPreview ? previewWidth / previewHeight : sourceWidth / sourceHeight;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceWidth / sourceHeight > aspect) {
    sw = sourceHeight * aspect;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / aspect;
    sy = (sourceHeight - sh) / 2;
  }

  const boundedZoom = Math.max(1, zoom);
  const zoomedWidth = sw / boundedZoom;
  const zoomedHeight = sh / boundedZoom;
  sx += (sw - zoomedWidth) / 2;
  sy += (sh - zoomedHeight) / 2;

  return { aspect, sx, sy, sw: zoomedWidth, sh: zoomedHeight };
}
