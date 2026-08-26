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

/**
 * Review-approved seed records.  These intentionally remain deterministic and
 * local until the PostgreSQL catalog import becomes the primary provider.
 */
export const CURATED_PRODUCTS: readonly CatalogProduct[] = [
  product("chobani-zero-sugar-strawberry", "818290019065", "Chobani", "Zero Sugar Greek Yogurt Strawberry", "5.3 oz", 2.7, 10.6),
  product("nature-valley-crunchy-oats-honey", "016000264781", "Nature Valley", "Crunchy Oats 'n Honey Granola Bars", "1.49 oz", 26, 8.8),
  product("hersheys-milk-chocolate", "034000002400", "Hershey's", "Milk Chocolate Bar", "1.55 oz", 51.2, 7),
  product("kind-dark-chocolate-nuts-sea-salt", "602652171022", "KIND", "Dark Chocolate Nuts & Sea Salt Bar", "1.4 oz", 17.5, 17.5),
  product("cheerios-original", "016000275847", "Cheerios", "Original Cereal", "8.9 oz", 4.5, 12.5),
  product("coca-cola-classic", "049000028904", "Coca-Cola", "Coca-Cola Classic", "12 fl oz", 10.6, 0),
  product("corona-extra-330ml-es", "8411327013376", "Corona", "Extra, cerveza lager", "330 ml", 0.2, 0.3),
  product("schweppes-tonica-original-330ml-es", "8414100317357", "Schweppes", "Tónica Original", "330 ml", 2.4, 0),
  product("schweppes-tonica-limon-330ml-es", "8414100381761", "Schweppes", "Tónica Limón", "330 ml", 4.4, 0),
  product("schweppes-tonica-zero-330ml-es", "8414100304753", "Schweppes", "Tónica Zero / clásica light", "330 ml", 0, 0),
  product("schweppes-limon-zero-330ml-es", "8414100381822", "Schweppes", "Limón Zero", "330 ml", 0, 0),
  product("coca-cola-sabor-original-330ml-es", "5449000000996", "Coca-Cola", "Sabor Original", "330 ml", 10.6, 0),
  product("coca-cola-zero-azucar-330ml-es", "5449000131805", "Coca-Cola", "Zero Azúcar", "330 ml", 0, 0),
  product("coca-cola-sabor-original-sin-cafeina-330ml-es", "5449000000774", "Coca-Cola", "Sabor Original Sin Cafeína", "330 ml", 11.1, 0),
  product("coca-cola-light-sin-cafeina-330ml-es", "5449000056672", "Coca-Cola", "Light Sin Cafeína", "330 ml", 0, 0),
  product("coca-cola-zero-azucar-lima-330ml-es", "5449000275165", "Coca-Cola", "Zero Azúcar Lima", "330 ml", 0, 0),
  product("coca-cola-zero-azucar-zero-cafeina-330ml-es", "5449000169327", "Coca-Cola", "Zero Azúcar Zero Cafeína", "330 ml", 0, 0),
  product("fanta-naranja-330ml-es", "5449000011527", "Fanta", "Naranja", "330 ml", 4.1, 0),
  product("nestea-te-al-limon-330ml-es", "8411092701133", "Nestea", "Té al Limón", "330 ml", 4.5, 0),
  product("nestea-te-verde-maracuya-330ml-es", "8411092731130", "Nestea", "Té Verde Maracuyá", "330 ml", 4, 0),
  product("sunny-delight-fresa-330ml-es", "8414100381860", "Sunny Delight", "Fresa", "330 ml", 2.4, 0),
  product("la-casera-tinto-verano-sin-alcohol-limon-330ml-es", "8410283381758", "La Casera", "Tinto de Verano Sin Alcohol Limón", "330 ml", 3.8, 0.1),
  product("la-casera-tinto-verano-limon-330ml-es", "8410283381710", "La Casera", "Tinto de Verano Limón", "330 ml", 1.1, 0),
  product("la-casera-tinto-verano-clasico-330ml-es", "8410283381048", "La Casera", "Tinto de Verano Clásico", "330 ml", 1.2, 0),
  product("la-lechera-leche-condensada-370g-es", "8410100000169", "La Lechera", "Leche condensada", "370 g", 54.9, 7.5),
];
