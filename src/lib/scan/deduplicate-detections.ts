import type { NormalizedBox } from "@/lib/contracts/product";
import type { Detection } from "@/lib/contracts/scan";
import { normalizeText } from "@/lib/catalog/normalization";

/**
 * A display-oriented group of repeated detections from a single shelf frame.
 * `detection` is always the first detection in visual reading order; consumers
 * should render `box`, which covers every grouped occurrence.
 */
export interface DetectionGroup {
  detection: Detection;
  count: number;
  box: NormalizedBox;
  memberIds: readonly string[];
}

interface MutableDetectionGroup {
  detection: Detection;
  count: number;
  box: NormalizedBox;
  memberIds: string[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundNormalized(value: number): number {
  return Number(clamp(value).toFixed(6));
}

export function unionNormalizedBoxes(left: NormalizedBox, right: NormalizedBox): NormalizedBox {
  const x = roundNormalized(Math.min(left.x, right.x));
  const y = roundNormalized(Math.min(left.y, right.y));
  const rightEdge = roundNormalized(Math.max(left.x + left.width, right.x + right.width));
  const bottomEdge = roundNormalized(Math.max(left.y + left.height, right.y + right.height));

  return {
    x,
    y,
    width: roundNormalized(Math.min(rightEdge - x, 1 - x)),
    height: roundNormalized(Math.min(bottomEdge - y, 1 - y)),
  };
}

function confirmedCatalogKey(detection: Detection): string | null {
  if (detection.status !== "confirmed") return null;
  const productId = detection.product?.id.trim();
  return productId ? `catalog:${productId}` : null;
}

function estimateKey(detection: Detection): string | null {
  if (detection.status !== "estimate" || detection.score.source !== "vision_estimate") return null;
  const brand = normalizeText(detection.visualCandidate.brand);
  const name = normalizeText(detection.visualCandidate.name);
  const packSize = normalizeText(detection.visualCandidate.packSize);
  const sugar = detection.score.sugarPer100g;
  if (!brand || !name || !packSize || sugar === null || !Number.isFinite(sugar)) return null;

  // Include both value and band: this intentionally avoids merging estimates
  // that merely look alike but received a materially different score.
  return `estimate:${brand}:${name}:${packSize}:${detection.score.band}:${sugar}`;
}

function groupKey(detection: Detection): string | null {
  return confirmedCatalogKey(detection) ?? estimateKey(detection);
}

/**
 * Groups only high-signal duplicate detections. Unknown items intentionally
 * remain independent, as do estimates without a complete matching identity.
 * The input detections and their nested values are never modified.
 */
export function groupRepeatedDetections(detections: readonly Detection[]): DetectionGroup[] {
  const groupsByKey = new Map<string, MutableDetectionGroup>();
  const orderedGroups: MutableDetectionGroup[] = [];

  for (const detection of detections) {
    const key = groupKey(detection);
    const existing = key ? groupsByKey.get(key) : undefined;
    if (existing) {
      existing.count += 1;
      existing.box = unionNormalizedBoxes(existing.box, detection.box);
      existing.memberIds.push(detection.id);
      continue;
    }

    const group: MutableDetectionGroup = {
      detection,
      count: 1,
      box: { ...detection.box },
      memberIds: [detection.id],
    };
    orderedGroups.push(group);
    if (key) groupsByKey.set(key, group);
  }

  return orderedGroups.map((group) => ({
    detection: group.detection,
    count: group.count,
    box: { ...group.box },
    memberIds: [...group.memberIds],
  }));
}
