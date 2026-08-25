import assert from "node:assert/strict";
import test from "node:test";
import { CuratedProductCatalog } from "./curated-product-catalog";
import { CURATED_PRODUCTS } from "./curated-products";
import { estimatedSnackCandidate, matchingChobaniCandidate, unknownCandidate } from "./fixtures/catalog-fixtures";
import { ProductResolver } from "./product-resolver";

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
