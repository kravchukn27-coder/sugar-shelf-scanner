import { createSugarScore } from "@/lib/scoring/sugar-score";
import type { CatalogProduct } from "./types";

const VERIFIED_AT = "2026-08-25T00:00:00.000Z";

function product(
  id: string,
  gtin: string,
  brand: string,
  name: string,
  packSize: string,
  sugarPer100g: number,
  proteinPer100g: number,
): CatalogProduct {
  return {
    id,
    gtin,
    brand,
    name,
    packSize,
    imageUrl: null,
    referenceImages: [],
    proteinPer100g,
    score: createSugarScore(sugarPer100g, "catalog"),
    provenance: { source: "curated", sourceRecordId: id, observedAt: VERIFIED_AT, lastVerifiedAt: VERIFIED_AT },
  };
}

/** Deliberately small, deterministic demo catalog; replace through a provider adapter. */
export const CURATED_PRODUCTS: readonly CatalogProduct[] = [
  product("chobani-zero-sugar-strawberry", "818290019065", "Chobani", "Zero Sugar Greek Yogurt Strawberry", "5.3 oz", 2.7, 10.6),
  product("nature-valley-crunchy-oats-honey", "016000264781", "Nature Valley", "Crunchy Oats 'n Honey Granola Bars", "1.49 oz", 26, 8.8),
  product("hersheys-milk-chocolate", "034000002400", "Hershey's", "Milk Chocolate Bar", "1.55 oz", 51.2, 7),
  product("kind-dark-chocolate-nuts-sea-salt", "602652171022", "KIND", "Dark Chocolate Nuts & Sea Salt Bar", "1.4 oz", 17.5, 17.5),
  product("cheerios-original", "016000275847", "Cheerios", "Original Cereal", "8.9 oz", 4.5, 12.5),
  product("coca-cola-classic", "049000028904", "Coca-Cola", "Coca-Cola Classic", "12 fl oz", 10.6, 0),
];
