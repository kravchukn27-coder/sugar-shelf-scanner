import { CURATED_PRODUCTS } from "./curated-products";
import type { CatalogProduct } from "./types";

export interface ApprovedCatalogProduct {
  product: CatalogProduct;
  aliases: readonly string[];
  sourceUrl: string;
}

const REVIEW_DETAILS: Readonly<Record<string, Omit<ApprovedCatalogProduct, "product">>> = {
  "corona-extra-330ml-es": { aliases: ["Corona", "Corona Extra", "Cerveza", "Cerveza mexicana", "33 cl", "330 ml"], sourceUrl: "https://www.compraonline.alcampo.es/products/corona-cerveza-mexicana-botella-de-33-5-cl/31757" },
  "schweppes-tonica-original-330ml-es": { aliases: ["Schweppes", "Tónica", "Tónica Original", "Original", "33 cl"], sourceUrl: "https://www.schweppes.es/tonicas/tonica-original/" },
  "schweppes-tonica-limon-330ml-es": { aliases: ["Schweppes", "Tónica Limón", "Tónica de limón", "Limón", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/schweppes-t%C3%B3nica-de-lim%C3%B3n-lata-de-33-cl/217056" },
  "schweppes-tonica-zero-330ml-es": { aliases: ["Schweppes", "Tónica Zero", "Tónica clásica light", "Light", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/schweppes-zero-t%C3%B3nica-cl%C3%A1sica-light-lata-de-33-cl/35787" },
  "schweppes-limon-zero-330ml-es": { aliases: ["Schweppes", "Limón Zero", "Schweppes Zero", "Refresco limón", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/schweppes-zero-refresco-de-lim%C3%B3n-lata-de-33-cl/98671" },
  "coca-cola-sabor-original-330ml-es": { aliases: ["Coca-Cola", "Coca Cola", "Coke", "Sabor Original", "Original", "Cola", "330 ml", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/coca-cola-refresco-de-cola-sabor-original-lata-de-330-ml/34053" },
  "coca-cola-zero-azucar-330ml-es": { aliases: ["Coca-Cola", "Coca Cola", "Coke", "Zero", "Zero Azúcar", "Sin azúcar", "330 ml", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/coca-cola-refresco-de-cola-zero-sin-az%C3%BAcar-lata-de-330-ml/22173" },
  "coca-cola-sabor-original-sin-cafeina-330ml-es": { aliases: ["Coca-Cola", "Coca Cola", "Original", "Sin cafeína", "Sin cafeina", "330 ml", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/coca-cola-sin-cafe%C3%ADna-refresco-de-cola-lata-33-cl/34074" },
  "coca-cola-light-sin-cafeina-330ml-es": { aliases: ["Coca-Cola", "Coca Cola", "Light", "Sin cafeína", "Sin cafeina", "330 ml", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/coca-cola-light-sin-cafe%C3%ADna-refresco-de-cola-lata-33-cl/38544" },
  "coca-cola-zero-azucar-lima-330ml-es": { aliases: ["Coca-Cola", "Coca Cola", "Zero Lime", "Zero Lima", "Lima", "330 ml", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/coca-cola-zero-az%C3%BAcar-refresco-de-cola-con-sabor-a-lima-lata-33-cl/515653" },
  "coca-cola-zero-azucar-zero-cafeina-330ml-es": { aliases: ["Coca-Cola", "Coca Cola", "Zero", "Zero cafeína", "Zero cafeina", "Sin azúcar", "330 ml", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/coca-cola-zero-az%C3%BAcar-zero-cafe%C3%ADna-refresco-de-cola-lata-33-cl/21895" },
  "fanta-naranja-330ml-es": { aliases: ["Fanta", "Fanta Naranja", "Naranja", "Refresco naranja", "330 ml", "33 cl"], sourceUrl: "https://www.tutrebol.es/naranja/1667-refresco-naranja-fanta-330-ml.html" },
  "nestea-te-al-limon-330ml-es": { aliases: ["Nestea", "Té al limón", "Té limón", "Limón", "33 cl", "330 ml"], sourceUrl: "https://www.compraonline.alcampo.es/products/nestea-bebida-de-t%C3%A9-al-lim%C3%B3n-lata-33-cl/32646" },
  "nestea-te-verde-maracuya-330ml-es": { aliases: ["Nestea", "Té verde", "Maracuyá", "Maracuya", "33 cl", "330 ml"], sourceUrl: "https://www.compraonline.alcampo.es/products/nestea-bebida-de-t%C3%A9-verde-con-maracuy%C3%A1-lata-de-33-cl/34919" },
  "sunny-delight-fresa-330ml-es": { aliases: ["Sunny Delight", "SunnyD", "Fresa", "Zumo fresa", "33 cl", "330 ml"], sourceUrl: "https://www.compraonline.alcampo.es/products/sunny-delight-zumo-con-sabor-a-fresa-33-cl/670408" },
  "la-casera-tinto-verano-sin-alcohol-limon-330ml-es": { aliases: ["La Casera", "Tinto de Verano", "Sin alcohol", "0,0", "Limón", "Limon", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/la-casera-tinto-de-verano-sin-alcohol-y-con-zumo-natural-de-lim%C3%B3n-lata-de-33-cl/34167" },
  "la-casera-tinto-verano-limon-330ml-es": { aliases: ["La Casera", "Tinto de Verano", "Limón", "Limon", "3,4%", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/la-casera-tinto-de-verano-con-zumo-natural-de-lim%C3%B3n-lata-de-33-cl/34075" },
  "la-casera-tinto-verano-clasico-330ml-es": { aliases: ["La Casera", "Tinto de Verano", "Clásico", "Clasico", "Gaseosa", "33 cl"], sourceUrl: "https://www.compraonline.alcampo.es/products/la-casera-tinto-de-verano-cl%C3%A1sico-con-gaseosa-la-casera-lata-de-33-cl/684976" },
  "la-lechera-leche-condensada-370g-es": { aliases: ["La Lechera", "Nestlé", "Nestle", "Leche condensada", "Condensada", "370 g"], sourceUrl: "https://www.carrefour.es/supermercado/leche-condensada-nestle-la-lechera-370-g/R-521003199/p" },
};

/** The import input is code, not a Markdown parser: it cannot silently ingest an unreviewed row. */
export const APPROVED_SPAIN_PRODUCTS: readonly ApprovedCatalogProduct[] = CURATED_PRODUCTS
  .filter((product) => REVIEW_DETAILS[product.id])
  .map((product) => ({ product, ...REVIEW_DETAILS[product.id] }));
