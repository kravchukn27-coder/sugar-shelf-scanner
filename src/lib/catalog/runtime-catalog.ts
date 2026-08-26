import { Pool } from "pg";
import { CuratedProductCatalog } from "./curated-product-catalog";
import { CURATED_PRODUCTS } from "./curated-products";
import { FreeProductCatalog } from "./free-product-catalog";
import { PostgresCatalogRepository, ReviewedDatabaseFirstCatalog, type SqlQueryExecutor } from "./repository";
import { getDatabaseCatalogStatus, type DatabaseCatalogStatus } from "./catalog-status";
import type { ProductCatalogProvider } from "./types";

type PoolHolder = { pool?: Pool };
const globalPool = globalThis as typeof globalThis & { __sugarCatalogPool?: PoolHolder };

function getPool(databaseUrl: string): Pool {
  const holder = globalPool.__sugarCatalogPool ??= {};
  if (!holder.pool) {
    // Catalog outages are availability failures, not scanner outages. Bound
    // connection and query waits so both the runtime fallback and health route
    // remain responsive when Railway has a stale or unreachable DATABASE_URL.
    holder.pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 1_500,
      query_timeout: 1_500,
    });
  }
  return holder.pool;
}

/** Safe operational check used by /api/health; it never exposes DATABASE_URL. */
export async function getRuntimeCatalogStatus(options: Pick<RuntimeCatalogOptions, "databaseUrl" | "executor">): Promise<DatabaseCatalogStatus> {
  if (!options.executor && !options.databaseUrl) return getDatabaseCatalogStatus(undefined, undefined);
  return getDatabaseCatalogStatus(options.databaseUrl, options.executor ?? getPool(options.databaseUrl!));
}

export interface RuntimeCatalogOptions {
  databaseUrl?: string;
  usdaApiKey?: string;
  openFoodFactsUserAgent?: string;
  /** Test seam; production uses a shared pg Pool. */
  executor?: SqlQueryExecutor;
  fetchImpl?: typeof fetch;
}

export function createFallbackCatalog(options: RuntimeCatalogOptions): ProductCatalogProvider {
  return new FreeProductCatalog(new CuratedProductCatalog(CURATED_PRODUCTS), {
    usdaApiKey: options.usdaApiKey,
    openFoodFactsUserAgent: options.openFoodFactsUserAgent,
    fetchImpl: options.fetchImpl,
  });
}

/**
 * Runtime ordering is PostgreSQL -> reviewed curated seed -> OFF/USDA. Merely
 * setting DATABASE_URL changes nothing until that DB contains reviewed rows.
 */
export async function createRuntimeCatalog(options: RuntimeCatalogOptions): Promise<ProductCatalogProvider> {
  const fallback = createFallbackCatalog(options);
  if (!options.executor && !options.databaseUrl) return fallback;

  const repository = new PostgresCatalogRepository(options.executor ?? getPool(options.databaseUrl!));
  try {
    return await repository.hasReviewedProducts()
      ? new ReviewedDatabaseFirstCatalog(repository, fallback)
      : fallback;
  } catch {
    return fallback;
  }
}
