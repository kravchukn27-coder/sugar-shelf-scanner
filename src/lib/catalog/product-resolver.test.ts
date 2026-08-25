import assert from "node:assert/strict";
import test from "node:test";
import { CuratedProductCatalog } from "./curated-product-catalog";
import { CURATED_PRODUCTS } from "./curated-products";
import { estimatedSnackCandidate, matchingChobaniCandidate, unknownCandidate } from "./fixtures/catalog-fixtures";
import { ProductResolver } from "./product-resolver";
import type { CatalogProduct, ProductCatalogProvider, VisualCandidate } from "./types";

const resolver = new ProductResolver(new CuratedProductCatalog(CURATED_PRODUCTS));

test("confirms a high-confidence visual match against the curated catalog", async () => {
  const result = await resolver.resolve(matchingChobaniCandidate);
  assert.equal(result.status, "confirmed");
  assert.equal(result.product?.id, "chobani-zero-sugar-strawberry");
  assert.equal(result.score.band, "green");
  assert.equal(result.score.source, "catalog");
});

test("keeps vision nutrition as an explicitly estimated result", async () => {
  const result = await resolver.resolve(estimatedSnackCandidate);
  assert.equal(result.status, "estimate");
  assert.equal(result.product, null);
  assert.equal(result.score.band, "red");
  assert.equal(result.score.source, "vision_estimate");
});

test("returns unknown when neither catalog nor vision has nutrition", async () => {
  const result = await resolver.resolve(unknownCandidate);
  assert.equal(result.status, "unknown");
  assert.equal(result.score.band, "unknown");
});

test("does not confirm a merely plausible catalog candidate", async () => {
  const product = CURATED_PRODUCTS[0] as CatalogProduct;
  const looseCatalog: ProductCatalogProvider = {
    lookupBarcode: async () => null,
    searchCandidates: async () => [{ product, confidence: 0.87 }],
    getProduct: async () => null,
    recordFeedback: async () => undefined,
  };
  const candidate: VisualCandidate = {
    brand: "Chobani",
    name: "Greek yogurt",
    packSize: null,
    confidence: 0.96,
  };

  const result = await new ProductResolver(looseCatalog).resolve(candidate);
  assert.equal(result.status, "unknown");
  assert.equal(result.product, null);
});

test("does not confirm an exact catalog match without usable sugar nutrition", async () => {
  const product: CatalogProduct = {
    ...(CURATED_PRODUCTS[0] as CatalogProduct),
    score: { band: "unknown", sugarPer100g: null, source: "unavailable" },
  };
  const catalog: ProductCatalogProvider = {
    lookupBarcode: async () => null,
    searchCandidates: async () => [{ product, confidence: 1 }],
    getProduct: async () => product,
    recordFeedback: async () => undefined,
  };

  const result = await new ProductResolver(catalog).resolve(matchingChobaniCandidate);
  assert.equal(result.status, "unknown");
  assert.equal(result.product, null);
});

test("does not launder a vision estimate through a catalog match", async () => {
  const product: CatalogProduct = {
    ...(CURATED_PRODUCTS[0] as CatalogProduct),
    score: { band: "green", sugarPer100g: 2.7, source: "vision_estimate" },
  };
  const catalog: ProductCatalogProvider = {
    lookupBarcode: async () => product,
    searchCandidates: async () => [{ product, confidence: 1 }],
    getProduct: async () => product,
    recordFeedback: async () => undefined,
  };
  const result = await new ProductResolver(catalog).resolve({ ...matchingChobaniCandidate, gtin: "818290019065" });
  assert.equal(result.status, "unknown");
  assert.equal(result.product, null);
});
