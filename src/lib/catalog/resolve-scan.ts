import type { AnalyzeScanResponse, Detection } from "@/lib/contracts/scan";
import { CuratedProductCatalog } from "./curated-product-catalog";
import { CURATED_PRODUCTS } from "./curated-products";
import { FreeProductCatalog } from "./free-product-catalog";
import { ProductResolver } from "./product-resolver";
import { logCatalogResolutionTelemetry } from "./telemetry";
import type { ServerEnv } from "@/lib/env";

async function resolveDetection(detection: Detection, resolver: ProductResolver): Promise<Detection> {
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
export async function resolveScan(response: AnalyzeScanResponse, env: ServerEnv): Promise<AnalyzeScanResponse> {
  const startedAt = performance.now();
  const resolver = new ProductResolver(new FreeProductCatalog(
    new CuratedProductCatalog(CURATED_PRODUCTS),
    { usdaApiKey: env.USDA_FDC_API_KEY, openFoodFactsUserAgent: env.OPEN_FOOD_FACTS_USER_AGENT },
  ));
  const resolvedResponse = {
    ...response,
    detections: await Promise.all(response.detections.map((detection) => resolveDetection(detection, resolver))),
  };
  logCatalogResolutionTelemetry(resolvedResponse.detections, performance.now() - startedAt);
  return resolvedResponse;
}
