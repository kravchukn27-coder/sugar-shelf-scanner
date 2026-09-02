import type { NormalizedBox } from "@/lib/contracts/product";
import { sugarFitForDetection } from "@/lib/scoring/detection-fit";
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
  // Only set for estimate groups; used to enforce packSizesConflict once a
  // group has multiple members that disagree on whether a size was legible.
  packSize?: string | null;
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

interface EstimateIdentity {
  brand: string;
  name: string;
  // Small-print pack size routinely fails to OCR on some facings of a dense
  // shelf (angle, glare, distance) even when brand/name/sugar read fine.
  // Treated as optional here rather than required: a facing with no legible
  // pack size can still join a group, but two facings that both read a pack
  // size still can't merge if those sizes actually differ (see packSizesConflict).
  packSize: string | null;
  sugar: number;
}

function estimateIdentity(detection: Detection): EstimateIdentity | null {
  if (detection.status !== "estimate" || detection.score.source !== "vision_estimate") return null;
  const brand = normalizeText(detection.visualCandidate.brand);
  const name = normalizeText(detection.visualCandidate.name);
  const sugar = detection.score.sugarPer100g;
  if (!brand || !name || sugar === null || !Number.isFinite(sugar)) return null;
  return { brand, name, packSize: normalizeText(detection.visualCandidate.packSize) || null, sugar };
}

function estimatePrefixKey(identity: EstimateIdentity, band: Detection["score"]["band"]): string {
  return `estimate:${identity.brand}:${identity.name}:${band}`;
}

function packSizesConflict(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
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

  const addNewGroup = (detection: Detection, packSize?: string | null): MutableDetectionGroup => {
    const group: MutableDetectionGroup = { detection, count: 1, box: { ...detection.box }, memberIds: [detection.id], packSize };
    orderedGroups.push(group);
    return group;
  };
  const mergeInto = (group: MutableDetectionGroup, detection: Detection, packSize?: string | null) => {
    group.count += 1;
    group.box = unionNormalizedBoxes(group.box, detection.box);
    group.memberIds.push(detection.id);
    // Backfill: an earlier member with no legible pack size shouldn't keep the
    // group blind to a size a later member did read.
    if (group.packSize == null && packSize != null) group.packSize = packSize;
  };

  for (const detection of detections) {
    const confirmedKey = confirmedCatalogKey(detection);
    if (confirmedKey) {
      const existing = confirmedGroupsByKey.get(confirmedKey);
      if (existing) mergeInto(existing, detection);
      else confirmedGroupsByKey.set(confirmedKey, addNewGroup(detection));
      continue;
    }

    const identity = estimateIdentity(detection);
    if (identity) {
      const prefixKey = estimatePrefixKey(identity, detection.score.band);
      const candidates = estimateGroupsByPrefix.get(prefixKey) ?? [];
      const match = candidates.find((group) =>
        Math.abs((group.detection.score.sugarPer100g ?? Infinity) - identity.sugar) <= ESTIMATE_SUGAR_TOLERANCE
        && !packSizesConflict(group.packSize ?? null, identity.packSize),
      );
      if (match) mergeInto(match, detection, identity.packSize);
      else {
        const group = addNewGroup(detection, identity.packSize);
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
 * Ranks products by the same Your Fit score the results list prints beside
 * each row, highest first. Sugar density alone is not that score — pack size,
 * the rest of the nutrition profile and the product category all move it — so
 * ranking on a density proxy ordered the list against its own numbers.
 * Products with no score, and ties, retain their existing visual order.
 */
export function sortDetectionGroupsBySugarFit(groups: readonly DetectionGroup[]): DetectionGroup[] {
  return groups
    .map((group, index) => ({ group, index, fit: sugarFitForDetection(group.detection) }))
    .sort((left, right) => {
      const leftRank = left.fit?.score ?? Number.NEGATIVE_INFINITY;
      const rightRank = right.fit?.score ?? Number.NEGATIVE_INFINITY;
      return rightRank - leftRank || left.index - right.index;
    })
    .map(({ group }) => group);
}
