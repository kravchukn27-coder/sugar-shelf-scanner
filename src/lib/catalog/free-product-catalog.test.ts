import assert from "node:assert/strict";
import test from "node:test";
import { CuratedProductCatalog } from "./curated-product-catalog";
import { CURATED_PRODUCTS } from "./curated-products";
import { FreeProductCatalog } from "./free-product-catalog";
import { ProductResolver } from "./product-resolver";

function unavailableCatalog(fetchImpl: typeof fetch) {
  return new ProductResolver(new FreeProductCatalog(
    new CuratedProductCatalog(CURATED_PRODUCTS),
    { fetchImpl },
  ));
}

test("an Open Food Facts 503 remains an estimate and never confirms a product", async () => {
  const resolver = unavailableCatalog(async () => new Response("unavailable", { status: 503 }));
  const result = await resolver.resolve({
    brand: "Unavailable Brand 503",
    name: "Unavailable product 503",
    packSize: "330 ml",
    confidence: 0.96,
    estimatedSugarPer100g: 17,
  });

  assert.equal(result.status, "estimate");
  assert.equal(result.product, null);
  assert.equal(result.score.source, "vision_estimate");
});

test("Open Food Facts network and payload failures stay unknown without a vision estimate", async () => {
  const networkFailure = unavailableCatalog(async () => {
    throw new Error("network down");
  });
  const invalidPayload = unavailableCatalog(async () => new Response("{}", { status: 200 }));

  const [networkResult, payloadResult] = await Promise.all([
    networkFailure.resolve({ brand: "Unavailable Network", name: "Product network", packSize: "330 ml", confidence: 0.96 }),
    invalidPayload.resolve({ brand: "Unavailable Payload", name: "Product payload", packSize: "330 ml", confidence: 0.96 }),
  ]);

  assert.equal(networkResult.status, "unknown");
  assert.equal(networkResult.product, null);
  assert.equal(payloadResult.status, "unknown");
  assert.equal(payloadResult.product, null);
});

test("persists a valid exact Open Food Facts barcode hit for the durable catalog", async () => {
  const persisted: string[] = [];
  const catalog = new FreeProductCatalog(new CuratedProductCatalog(CURATED_PRODUCTS), {
    fetchImpl: async () => Response.json({ product: { code: "5901234123457", product_name: "Durable demo drink", brands: "Demo", quantity: "330 ml", nutriments: { sugars_100g: 4.2, proteins_100g: 0.1 } } }),
    persistOpenFoodFactsBarcode: async (product) => { persisted.push(product.gtin ?? ""); },
  });

  const product = await catalog.lookupBarcode("5901234123457");
  assert.equal(product?.name, "Durable demo drink");
  assert.deepEqual(persisted, ["5901234123457"]);
});

test("the public-source search budget is an availability limit, not a confirmed absence", async () => {
  let calls = 0;
  const resolver = unavailableCatalog(async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  });

  for (let index = 0; index < 4; index += 1) {
    const result = await resolver.resolve({
      brand: `Budget Brand ${index}`,
      name: `Budget Product ${index}`,
      packSize: "330 ml",
      confidence: 0.96,
    });
    assert.equal(result.status, "unknown");
    assert.equal(result.product, null);
  }

  assert.equal(calls, 3);
});
