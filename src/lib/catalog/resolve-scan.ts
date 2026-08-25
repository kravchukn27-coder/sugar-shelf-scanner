import type { AnalyzeScanResponse, Detection } from "@/lib/contracts/scan";
import { CuratedProductCatalog } from "./curated-product-catalog";
import { CURATED_PRODUCTS } from "./curated-products";
import { ProductResolver } from "./product-resolver";

const resolver = new ProductResolver(new CuratedProductCatalog(CURATED_PRODUCTS));

async function resolveDetection(detection: Detection): Promise<Detection> {
  const resolved = await resolver.resolve({
    ...detection.visualCandidate,
    confidence: detection.confidence,
    estimatedSugarPer100g: detection.score.source === "vision_estimate"
      ? detection.score.sugarPer100g
      : null,
    estimateReason: detection.estimateReason,
  });

  return {
    ...detection,
    status: resolved.status,
    product: resolved.product,
    score: resolved.score,
    estimateReason: resolved.estimateReason,
  };
}

/**
 * Applies the active product catalog consistently to mock and Gemini vision
 * outputs. A future provider replaces the catalog instance, not camera or UI.
 */
export async function resolveScan(response: AnalyzeScanResponse): Promise<AnalyzeScanResponse> {
  return {
    ...response,
    detections: await Promise.all(response.detections.map(resolveDetection)),
  };
}
