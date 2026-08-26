import { createSugarScore } from "@/lib/scoring/sugar-score";
import type { CatalogProduct, ProductCatalogProvider, ResolvedProduct, VisualCandidate } from "./types";

// This is intentionally aligned with scoreCatalogMatch's "confirmed" band.
// A plausible textual result may still be useful as a future UI suggestion,
// but must not turn an AI nutrition estimate into a confirmed catalog fact.
export const CONFIRMED_MATCH_THRESHOLD = 0.85;
export const MIN_VISION_CONFIDENCE_FOR_CONFIRMATION = 0.65;

function hasConfirmedCatalogNutrition(product: CatalogProduct): boolean {
  return product.score.source === "catalog"
    && typeof product.score.sugarPer100g === "number"
    && Number.isFinite(product.score.sugarPer100g)
    && product.score.sugarPer100g >= 0;
}

export class ProductResolver {
  public constructor(private readonly catalog: ProductCatalogProvider) {}

  public async resolve(candidate: VisualCandidate): Promise<ResolvedProduct> {
    const gtin = candidate.gtin?.replace(/\D/g, "") ?? "";
    if (gtin.length >= 8 && gtin.length <= 14) {
      const barcodeProduct = await this.catalog.lookupBarcode(gtin);
      if (barcodeProduct && hasConfirmedCatalogNutrition(barcodeProduct)) {
        return {
          status: "confirmed",
          product: barcodeProduct,
          score: barcodeProduct.score,
          estimateReason: null,
          matchConfidence: 1,
        };
      }
    }

    const [bestMatch] = await this.catalog.searchCandidates(candidate, 1);
    if (
      bestMatch &&
      bestMatch.confidence >= CONFIRMED_MATCH_THRESHOLD &&
      hasConfirmedCatalogNutrition(bestMatch.product) &&
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
