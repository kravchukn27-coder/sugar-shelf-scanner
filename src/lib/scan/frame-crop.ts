export type SourceFrameCrop = {
  aspect: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

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
