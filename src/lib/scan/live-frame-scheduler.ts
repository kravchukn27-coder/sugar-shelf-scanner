import { shouldBypassQualityAfterSkips, shouldSkipPreflight, type FrameQuality } from "./frame-quality";
import { isFrameMoving } from "./frame-stillness";

export type LiveFrameSchedulerDecision = {
  baseline: Uint8ClampedArray;
  qualitySkipStreak: number;
  action: "dispatch" | "motion_skip" | "quality_skip";
  qualitySkipped: boolean;
};

/**
 * The rollout flag only changes when the first stillness reference is taken.
 * When disabled, returning null preserves the existing first-tick behaviour.
 */
export function createInitialLiveFrameBaseline(
  immediateBaselineEnabled: boolean,
  sample: Uint8ClampedArray | null,
): Uint8ClampedArray | null {
  return immediateBaselineEnabled ? sample : null;
}

/**
 * Decide what a live scheduler tick may do after the caller has sampled pixels.
 * It is deliberately DOM/network-free, so motion and quality policy can be
 * verified without a camera or a Gemini request.
 */
export function decideLiveFrameSchedulerTick({
  previous,
  current,
  quality,
  qualityEnabled,
  qualitySkipStreak,
}: {
  previous: Uint8ClampedArray | null;
  current: Uint8ClampedArray;
  quality: FrameQuality | null;
  qualityEnabled: boolean;
  qualitySkipStreak: number;
}): LiveFrameSchedulerDecision {
  if (previous && isFrameMoving(previous, current)) {
    return { baseline: current, qualitySkipStreak: 0, action: "motion_skip", qualitySkipped: false };
  }

  // An unavailable quality sample retains the prior scheduler fallback: do not
  // block a potentially valid scan merely because a browser cannot read pixels.
  if (!qualityEnabled || !quality) {
    return { baseline: current, qualitySkipStreak: 0, action: "dispatch", qualitySkipped: false };
  }

  if (shouldSkipPreflight(quality)) {
    const nextQualitySkipStreak = qualitySkipStreak + 1;
    if (!shouldBypassQualityAfterSkips(nextQualitySkipStreak)) {
      return { baseline: current, qualitySkipStreak: nextQualitySkipStreak, action: "quality_skip", qualitySkipped: true };
    }
  }

  return { baseline: current, qualitySkipStreak: 0, action: "dispatch", qualitySkipped: shouldSkipPreflight(quality) };
}
