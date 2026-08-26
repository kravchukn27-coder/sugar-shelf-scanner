import type { AnalyzeScanResponse, Detection } from "@/lib/contracts/scan";
import { ProductResolver } from "./product-resolver";
import { createRuntimeCatalog } from "./runtime-catalog";
import { logCatalogResolutionTelemetry } from "./telemetry";
import type { ServerEnv } from "@/lib/env";
import type { ResolvedProduct, ProductCatalogProvider } from "./types";

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
export async function resolveScan(
  response: AnalyzeScanResponse,
  env: ServerEnv,
  // Callers that already started the catalog DB probe alongside the vision
  // call (see the analyze route) pass its promise here so this function does
  // not re-issue it and does not wait on it after the fact.
  catalog?: Promise<ProductCatalogProvider>,
): Promise<AnalyzeScanResponse> {
  const startedAt = performance.now();
  const resolver = new ProductResolver(await (catalog ?? createRuntimeCatalog({
    databaseUrl: env.DATABASE_URL,
    usdaApiKey: env.USDA_FDC_API_KEY,
    openFoodFactsUserAgent: env.OPEN_FOOD_FACTS_USER_AGENT,
  })));
  const resolvedResponse = {
    ...response,
    detections: await Promise.all(response.detections.map((detection) => resolveDetection(detection, resolver))),
  };
  logCatalogResolutionTelemetry(resolvedResponse.detections, performance.now() - startedAt);
  return resolvedResponse;
}

/** A barcode is decoded in the browser, then resolved without any vision call. */
export async function resolveBarcode(gtin: string, env: ServerEnv): Promise<ResolvedProduct> {
  const resolver = new ProductResolver(await createRuntimeCatalog({
    databaseUrl: env.DATABASE_URL,
    usdaApiKey: env.USDA_FDC_API_KEY,
    openFoodFactsUserAgent: env.OPEN_FOOD_FACTS_USER_AGENT,
  }));
  return resolver.resolve({ brand: null, name: null, packSize: null, gtin, confidence: 1 });
}
