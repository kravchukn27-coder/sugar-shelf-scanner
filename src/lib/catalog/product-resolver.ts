import { createSugarScore } from "@/lib/scoring/sugar-score";
import type { ProductCatalogProvider, ResolvedProduct, VisualCandidate } from "./types";

export const CONFIRMED_MATCH_THRESHOLD = 0.78;
export const MIN_VISION_CONFIDENCE_FOR_CONFIRMATION = 0.65;

export class ProductResolver {
  public constructor(private readonly catalog: ProductCatalogProvider) {}

  public async resolve(candidate: VisualCandidate): Promise<ResolvedProduct> {
    const [bestMatch] = await this.catalog.searchCandidates(candidate, 1);
    if (
      bestMatch &&
      bestMatch.confidence >= CONFIRMED_MATCH_THRESHOLD &&
      candidate.confidence >= MIN_VISION_CONFIDENCE_FOR_CONFIRMATION
    ) {
      return {
        status: "confirmed",
        product: bestMatch.product,
        score: bestMatch.product.score,
        estimateReason: null,
        matchConfidence: bestMatch.confidence,
      };
    }

    if (candidate.estimatedSugarPer100g !== null && candidate.estimatedSugarPer100g !== undefined) {
      return {
        status: "estimate",
        product: null,
        score: createSugarScore(candidate.estimatedSugarPer100g, "vision_estimate"),
        estimateReason: candidate.estimateReason ?? "Packaging text and visual cues provide an approximate sugar value.",
        matchConfidence: bestMatch?.confidence ?? null,
      };
    }

    return {
      status: "unknown",
      product: null,
      score: createSugarScore(null, "unavailable"),
      estimateReason: "Take a closer photo, barcode, or nutrition label to confirm this product.",
      matchConfidence: bestMatch?.confidence ?? null,
    };
  }
}
