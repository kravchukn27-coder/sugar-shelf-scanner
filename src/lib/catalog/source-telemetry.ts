export type CatalogSource = "open_food_facts" | "usda_food_data_central";
export type CatalogSourceOperation = "search" | "barcode";
export type CatalogSourceOutcome = "success" | "http_error" | "timeout" | "invalid_payload" | "disabled";

type CatalogSourceTelemetry = {
  source: CatalogSource;
  operation: CatalogSourceOperation;
  outcome: CatalogSourceOutcome;
  durationMs: number;
  candidateCount: number;
  cacheHit: boolean;
};

/**
 * Records only operational health of public catalog integrations. Do not add
 * query text, product names, GTINs, URLs, response bodies, API keys, or images
 * here: Railway logs are not a product-data store.
 */
export function logCatalogSourceTelemetry(event: CatalogSourceTelemetry) {
  console.info(JSON.stringify({
    event: "catalog_source_request",
    source: event.source,
    operation: event.operation,
    outcome: event.outcome,
    durationMs: Math.max(0, Math.round(event.durationMs)),
    candidateCount: Math.max(0, Math.round(event.candidateCount)),
    cacheHit: event.cacheHit,
  }));
}
