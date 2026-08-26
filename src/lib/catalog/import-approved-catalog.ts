import { createHash } from "node:crypto";
import { APPROVED_SPAIN_PRODUCTS, type ApprovedCatalogProduct } from "./approved-spain";
import { normalizeSearchText, normalizeText } from "./normalization";
import type { SqlQueryExecutor } from "./repository";

/** Stable UUIDs make a repeated import an idempotent upsert, not a duplicate. */
export function stableCatalogUuid(value: string): string {
  const hex = createHash("sha256").update(`sugar-shelf-scanner:${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface ApprovedCatalogImportResult { imported: number; }

/**
 * Imports only the code-locked review table. It deliberately does not parse
 * CATALOG_REVIEW_SPAIN.md, so changing prose cannot add unapproved records.
 */
export async function importApprovedSpainCatalog(
  db: SqlQueryExecutor,
  products: readonly ApprovedCatalogProduct[] = APPROVED_SPAIN_PRODUCTS,
  importedAt = new Date().toISOString(),
): Promise<ApprovedCatalogImportResult> {
  for (const entry of products) await upsertApprovedProduct(db, entry, importedAt);
  return { imported: products.length };
}

async function upsertApprovedProduct(db: SqlQueryExecutor, entry: ApprovedCatalogProduct, importedAt: string): Promise<void> {
  const { product, aliases, sourceUrl } = entry;
  if (!product.gtin || product.score.sugarPer100g === null || product.proteinPer100g === null) {
    throw new Error(`Approved product ${product.id} is missing GTIN or nutrition.`);
  }
  const productId = stableCatalogUuid(`product:${product.id}`);
  const provenanceId = stableCatalogUuid(`provenance:${product.id}:curated`);
  const normalized = normalizeSearchText({ brand: product.brand, name: product.name, flavour: product.flavour, packSize: product.packSize });
  await db.query(`INSERT INTO products (id, canonical_brand, canonical_name, canonical_flavour, canonical_pack_size, normalized_search_text, image_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET canonical_brand = EXCLUDED.canonical_brand, canonical_name = EXCLUDED.canonical_name,
      canonical_flavour = EXCLUDED.canonical_flavour, canonical_pack_size = EXCLUDED.canonical_pack_size,
      normalized_search_text = EXCLUDED.normalized_search_text, image_url = EXCLUDED.image_url, updated_at = now()`,
  [productId, product.brand, product.name, product.flavour ?? null, product.packSize, normalized, product.imageUrl]);
  await db.query(`INSERT INTO identifiers (id, product_id, type, value) VALUES ($1, $2, 'gtin', $3)
    ON CONFLICT (type, value) DO UPDATE SET product_id = EXCLUDED.product_id`,
  [stableCatalogUuid(`identifier:gtin:${product.gtin}`), productId, product.gtin]);
  await db.query(`INSERT INTO provenance (id, product_id, source, source_record_id, source_url, observed_at, verified_at)
    VALUES ($1, $2, 'curated', $3, $4, $5::timestamptz, $5::timestamptz)
    ON CONFLICT (product_id, source, source_record_id) DO UPDATE SET source_url = EXCLUDED.source_url,
      observed_at = EXCLUDED.observed_at, verified_at = EXCLUDED.verified_at`,
  [provenanceId, productId, product.id, sourceUrl, importedAt]);
  await db.query(`INSERT INTO nutrition_facts (product_id, sugar_per_100g, protein_per_100g, energy_kcal_per_100g, fat_per_100g, carbohydrates_per_100g, provenance_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (product_id) DO UPDATE SET sugar_per_100g = EXCLUDED.sugar_per_100g,
      protein_per_100g = EXCLUDED.protein_per_100g, energy_kcal_per_100g = EXCLUDED.energy_kcal_per_100g,
      fat_per_100g = EXCLUDED.fat_per_100g, carbohydrates_per_100g = EXCLUDED.carbohydrates_per_100g,
      provenance_id = EXCLUDED.provenance_id`,
  [productId, product.score.sugarPer100g, product.proteinPer100g, product.energyKcalPer100g, product.fatPer100g, product.carbohydratesPer100g, provenanceId]);
  const allAliases = new Set([product.brand, product.name, `${product.brand ?? ""} ${product.name}`, ...aliases].filter((alias): alias is string => Boolean(alias?.trim())));
  for (const alias of allAliases) {
    await db.query(`INSERT INTO product_aliases (id, product_id, alias_type, alias, normalized_alias)
      VALUES ($1, $2, 'full_label', $3, $4)
      ON CONFLICT (product_id, alias_type, normalized_alias) DO UPDATE SET alias = EXCLUDED.alias`,
    [stableCatalogUuid(`alias:${product.id}:${normalizeText(alias)}`), productId, alias, normalizeText(alias)]);
  }
}
