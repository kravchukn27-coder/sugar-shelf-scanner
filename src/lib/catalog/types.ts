import type { ProductSummary, SugarScore } from "@/lib/contracts/product";

export type CatalogDataSource = "curated" | "open_food_facts" | "commercial";

export interface ProductProvenance {
  source: CatalogDataSource;
  sourceRecordId: string;
  lastVerifiedAt: string;
}

export interface CatalogProduct extends ProductSummary {
  referenceImages: string[];
  provenance: ProductProvenance;
}

export interface VisualCandidate {
  brand: string | null;
  name: string | null;
  packSize: string | null;
  confidence: number;
  estimatedSugarPer100g?: number | null;
  estimateReason?: string | null;
}

export interface CatalogMatch {
  product: CatalogProduct;
  confidence: number;
}

export interface CatalogFeedback {
  scanId: string;
  productId: string | null;
  candidate: VisualCandidate;
  outcome: "confirmed" | "rejected" | "corrected";
}

/**
 * Provider boundary for the curated seed catalog, Open Food Facts, and licensed
 * product-content suppliers. Consumers never need to know the data source.
 */
export interface ProductCatalogProvider {
  lookupBarcode(gtin: string): Promise<CatalogProduct | null>;
  searchCandidates(candidate: VisualCandidate, limit?: number): Promise<CatalogMatch[]>;
  getProduct(id: string): Promise<CatalogProduct | null>;
  recordFeedback(feedback: CatalogFeedback): Promise<void>;
}

export interface ResolvedProduct {
  status: "confirmed" | "estimate" | "unknown";
  product: ProductSummary | null;
  score: SugarScore;
  estimateReason: string | null;
  matchConfidence: number | null;
}
