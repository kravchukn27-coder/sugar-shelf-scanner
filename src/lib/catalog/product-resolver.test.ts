import assert from "node:assert/strict";
import test from "node:test";
import { CuratedProductCatalog } from "./curated-product-catalog";
import { CURATED_PRODUCTS } from "./curated-products";
import {
  coronaSpainCandidates,
  estimatedSnackCandidate,
  matchingSpanishCatalogCandidates,
  matchingChobaniCandidate,
  schweppesLimonCandidate,
  unknownCandidate,
  wrongCoronaSpainCandidates,
} from "./fixtures/catalog-fixtures";
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

test("confirms the approved Spanish Corona single bottle aliases using catalog nutrition", async () => {
  for (const candidate of coronaSpainCandidates) {
    const result = await resolver.resolve({ ...candidate, estimatedSugarPer100g: 42 });
    assert.equal(result.status, "confirmed", candidate.name ?? "Corona candidate");
    assert.equal(result.product?.id, "corona-extra-330ml-es");
    assert.equal(result.product?.packSize, "330 ml");
    assert.equal(result.product?.score.sugarPer100g, 0.2);
    assert.equal(result.product?.proteinPer100g, 0.3);
    assert.equal(result.score.source, "catalog");
  }
});

test("does not confirm a different Corona variant or pack size", async () => {
  for (const candidate of wrongCoronaSpainCandidates) {
    const result = await resolver.resolve(candidate);
    assert.notEqual(result.status, "confirmed", candidate.name ?? "Corona candidate");
    assert.notEqual(result.product?.id, "corona-extra-330ml-es");
  }
});

test("does not confirm Corona when Gemini identifies only the brand", async () => {
  const result = await resolver.resolve({ brand: "Corona", name: null, packSize: "330 ml", confidence: 0.96 });
  assert.notEqual(result.status, "confirmed");
  assert.notEqual(result.product?.id, "corona-extra-330ml-es");
});

test("confirms approved Spanish Schweppes and La Lechera records from catalog nutrition", async () => {
  for (const { candidate, productId, sugar, protein } of matchingSpanishCatalogCandidates) {
    const result = await resolver.resolve({ ...candidate, estimatedSugarPer100g: 99 });
    assert.equal(result.status, "confirmed", candidate.name ?? productId);
    assert.equal(result.product?.id, productId);
    assert.equal(result.score.source, "catalog");
    assert.equal(result.score.sugarPer100g, sugar);
    assert.equal(result.product?.proteinPer100g, protein);
  }
});

test("confirms La Lechera when vision returns the common Nestlé La Lechera brand form", async () => {
  const result = await resolver.resolve({
    brand: "Nestlé La Lechera",
    name: "Leche condensada",
    packSize: "370 g",
    confidence: 0.96,
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.product?.id, "la-lechera-leche-condensada-370g-es");
  assert.equal(result.score.source, "catalog");
});

test("selects Schweppes Tónica Limón instead of the same-brand Original variant", async () => {
  const result = await resolver.resolve(schweppesLimonCandidate);
  assert.equal(result.status, "confirmed");
  assert.equal(result.product?.id, "schweppes-tonica-limon-330ml-es");
  assert.notEqual(result.product?.id, "schweppes-tonica-original-330ml-es");
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
    searchCandidates: async () => [{ product, confidence: 0.84 }],
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
