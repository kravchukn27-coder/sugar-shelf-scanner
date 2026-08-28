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

// Per-crop vision estimates of the same physical product routinely wobble by
// a few grams facing to facing (independent AI reads of the same package).
// Tolerating that noise means matching against a range, not an exact value —
// `band` still guards against merging two products with a materially
// different score. Demo priority is a clean, grouped shelf view over precise
// per-facing sugar figures.
const ESTIMATE_SUGAR_TOLERANCE = 5;

function estimatePrefixKey(detection: Detection): string | null {
  if (detection.status !== "estimate" || detection.score.source !== "vision_estimate") return null;
  const brand = normalizeText(detection.visualCandidate.brand);
  const name = normalizeText(detection.visualCandidate.name);
  const packSize = normalizeText(detection.visualCandidate.packSize);
  const sugar = detection.score.sugarPer100g;
  if (!brand || !name || !packSize || sugar === null || !Number.isFinite(sugar)) return null;
  return `estimate:${brand}:${name}:${packSize}:${detection.score.band}`;
}

/**
 * Groups only high-signal duplicate detections. Unknown items intentionally
 * remain independent, as do estimates without a complete matching identity.
 * The input detections and their nested values are never modified.
 */
export function groupRepeatedDetections(detections: readonly Detection[]): DetectionGroup[] {
  const confirmedGroupsByKey = new Map<string, MutableDetectionGroup>();
  // Several estimate groups can share one prefix (different sugar ranges), so
  // this holds a small list per prefix rather than one group per key — the
  // new detection joins whichever existing group's own sugar estimate is
  // within tolerance, or starts a new one in that same list.
  const estimateGroupsByPrefix = new Map<string, MutableDetectionGroup[]>();
  const orderedGroups: MutableDetectionGroup[] = [];

  const addNewGroup = (detection: Detection): MutableDetectionGroup => {
    const group: MutableDetectionGroup = { detection, count: 1, box: { ...detection.box }, memberIds: [detection.id] };
    orderedGroups.push(group);
    return group;
  };
  const mergeInto = (group: MutableDetectionGroup, detection: Detection) => {
    group.count += 1;
    group.box = unionNormalizedBoxes(group.box, detection.box);
    group.memberIds.push(detection.id);
  };

  for (const detection of detections) {
    const confirmedKey = confirmedCatalogKey(detection);
    if (confirmedKey) {
      const existing = confirmedGroupsByKey.get(confirmedKey);
      if (existing) mergeInto(existing, detection);
      else confirmedGroupsByKey.set(confirmedKey, addNewGroup(detection));
      continue;
    }

    const prefixKey = estimatePrefixKey(detection);
    if (prefixKey) {
      const sugar = detection.score.sugarPer100g as number;
      const candidates = estimateGroupsByPrefix.get(prefixKey) ?? [];
      const match = candidates.find((group) => Math.abs((group.detection.score.sugarPer100g ?? Infinity) - sugar) <= ESTIMATE_SUGAR_TOLERANCE);
      if (match) mergeInto(match, detection);
      else {
        const group = addNewGroup(detection);
        candidates.push(group);
        estimateGroupsByPrefix.set(prefixKey, candidates);
      }
      continue;
    }

    addNewGroup(detection);
  }

  return orderedGroups.map((group) => ({
    detection: group.detection,
    count: group.count,
    box: { ...group.box },
    memberIds: [...group.memberIds],
  }));
}

/**
 * Ranks known products by their Sugar Fit score: 100 minus grams of sugar per
 * 100g. Equal and unavailable scores retain their existing visual order.
 */
export function sortDetectionGroupsBySugarFit(groups: readonly DetectionGroup[]): DetectionGroup[] {
  return groups
    .map((group, index) => ({ group, index, sugar: group.detection.score.sugarPer100g }))
    .sort((left, right) => {
      const leftRank = left.sugar === null || !Number.isFinite(left.sugar) ? Number.NEGATIVE_INFINITY : Math.max(0, 100 - left.sugar);
      const rightRank = right.sugar === null || !Number.isFinite(right.sugar) ? Number.NEGATIVE_INFINITY : Math.max(0, 100 - right.sugar);
      return rightRank - leftRank || left.index - right.index;
    })
    .map(({ group }) => group);
}
