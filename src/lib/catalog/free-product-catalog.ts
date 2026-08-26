import { createSugarScore } from "@/lib/scoring/sugar-score";
import type { CatalogFeedback, CatalogMatch, CatalogProduct, ProductCatalogProvider, VisualCandidate } from "./types";
import { scoreCatalogMatch } from "./normalization";
import { logCatalogSourceTelemetry, type CatalogSource, type CatalogSourceOperation } from "./source-telemetry";

type FetchLike = typeof fetch;

type OpenFoodFactsProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  quantity?: string;
  nutriments?: { sugars_100g?: number; proteins_100g?: number; "energy-kcal_100g"?: number; fat_100g?: number; carbohydrates_100g?: number };
};

type UsdaFood = {
  fdcId?: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  labelNutrients?: { sugars?: { value?: number }; protein?: { value?: number }; calories?: { value?: number }; fat?: { value?: number }; carbohydrates?: { value?: number } };
};

const REMOTE_TIMEOUT_MS = 2_250;
const OPEN_FOOD_FACTS_RETRY_BACKOFF_MS = 80;
const POSITIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 250;

type CacheEntry<T> = { value: T; expiresAt: number };
type TimedFetchResult =
  | { kind: "response"; response: Response }
  | { kind: "timeout" }
  | { kind: "http_error" };
type RemoteFetchResult = TimedFetchResult | { kind: "budget_exhausted" };

type SourceRequest = { source: CatalogSource; operation: CatalogSourceOperation };

// This cache intentionally lives in the server process, not the browser. It
// makes repeated shelf scans cheap and keeps temporary upstream incidents from
// turning every video frame into another remote request. Railway may create a
// new process at any time, so it is only a protective cache, not persistence.
const remoteCache = new Map<string, CacheEntry<CatalogProduct[]>>();
const inFlightRemoteLoads = new Map<string, Promise<CatalogProduct[]>>();

function per100g(perServing: number | undefined, servingSize: number | undefined, servingUnit: string | undefined): number | null {
  if (typeof perServing !== "number" || !Number.isFinite(perServing)) return null;
  if (servingUnit?.toLowerCase() !== "g" || !servingSize || servingSize <= 0) return null;
  return Number(((perServing / servingSize) * 100).toFixed(2));
}

function openFoodFactsProduct(product: OpenFoodFactsProduct, observedAt: string): CatalogProduct | null {
  const name = product.product_name?.trim();
  if (!name) return null;
  const sugars = product.nutriments?.sugars_100g;
  return {
    id: `off-${product.code ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    gtin: product.code?.replace(/\D/g, "") || null,
    brand: product.brands?.split(",")[0]?.trim() || null,
    name,
    packSize: product.quantity?.trim() || null,
    // We identify from text and UPC first. Do not ingest or persist source photos.
    imageUrl: null,
    referenceImages: [],
    energyKcalPer100g: product.nutriments?.["energy-kcal_100g"] ?? null,
    proteinPer100g: product.nutriments?.proteins_100g ?? null,
    fatPer100g: product.nutriments?.fat_100g ?? null,
    carbohydratesPer100g: product.nutriments?.carbohydrates_100g ?? null,
    score: createSugarScore(typeof sugars === "number" ? sugars : null, "catalog"),
    provenance: {
      source: "open_food_facts",
      sourceRecordId: product.code ?? name,
      observedAt,
      // The public API response does not provide a trustworthy source
      // verification timestamp in this narrow payload.
      lastVerifiedAt: null,
    },
  };
}

function usdaFoodProduct(food: UsdaFood, observedAt: string): CatalogProduct | null {
  const name = food.description?.trim();
  if (!name || !food.fdcId) return null;
  return {
    id: `usda-${food.fdcId}`,
    gtin: food.gtinUpc?.replace(/\D/g, "") || null,
    brand: food.brandOwner?.trim() || food.brandName?.trim() || null,
    name,
    packSize: food.servingSize && food.servingSizeUnit ? `${food.servingSize} ${food.servingSizeUnit}` : null,
    imageUrl: null,
    referenceImages: [],
    energyKcalPer100g: per100g(food.labelNutrients?.calories?.value, food.servingSize, food.servingSizeUnit),
    proteinPer100g: per100g(food.labelNutrients?.protein?.value, food.servingSize, food.servingSizeUnit),
    fatPer100g: per100g(food.labelNutrients?.fat?.value, food.servingSize, food.servingSizeUnit),
    carbohydratesPer100g: per100g(food.labelNutrients?.carbohydrates?.value, food.servingSize, food.servingSizeUnit),
    score: createSugarScore(per100g(food.labelNutrients?.sugars?.value, food.servingSize, food.servingSizeUnit), "catalog"),
    provenance: {
      source: "usda_food_data_central",
      sourceRecordId: String(food.fdcId),
      observedAt,
      lastVerifiedAt: null,
    },
  };
}

/**
 * Catalog chain for the first demo. Curated data remains fastest and most
 * reliable; public APIs fill gaps without copying their package photography.
 */
export class FreeProductCatalog implements ProductCatalogProvider {
  private remoteSearches = 0;
  // This counts actual OFF HTTP attempts (including a retry), not logical
  // catalog searches. It intentionally mirrors the existing per-scan ceiling.
  private openFoodFactsAttempts = 0;

  public constructor(
    private readonly curated: ProductCatalogProvider,
    private readonly options: { usdaApiKey?: string; openFoodFactsUserAgent?: string; fetchImpl?: FetchLike; persistOpenFoodFactsBarcode?: (product: CatalogProduct) => Promise<void> } = {},
  ) {}

  private get fetch(): FetchLike { return this.options.fetchImpl ?? fetch; }

  public async lookupBarcode(gtin: string): Promise<CatalogProduct | null> {
    const local = await this.curated.lookupBarcode(gtin);
    if (local) return local;
    if (!this.reserveRemoteSearch()) return null;

    const normalized = gtin.replace(/\D/g, "");
    const [fromOff, fromUsda] = await Promise.all([
      this.fetchOpenFoodFactsByBarcode(normalized),
      this.fetchUsdaByQuery(normalized),
    ]);
    if (fromOff) {
      await this.options.persistOpenFoodFactsBarcode?.(fromOff).catch(() => undefined);
      return fromOff;
    }
    return fromUsda[0] ?? null;
  }

  public async searchCandidates(candidate: VisualCandidate, limit = 3): Promise<CatalogMatch[]> {
    const local = await this.curated.searchCandidates(candidate, limit);
    // Only skip public sources when local text evidence is already strong
    // enough to confirm. A merely plausible curated match must not mask a
    // potentially exact match from a source record.
    if (local[0]?.confidence >= 0.85) return local;

    const query = [candidate.brand, candidate.name].filter(Boolean).join(" ").trim();
    if (!query || !this.reserveRemoteSearch()) return local;
    const [off, usda] = await Promise.all([this.searchOpenFoodFacts(query, limit), this.fetchUsdaByQuery(query, limit)]);
    return [...local.map((match) => match.product), ...off, ...usda]
      .map((product) => ({ product, confidence: scoreCatalogMatch(candidate, product).confidence }))
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence || a.product.id.localeCompare(b.product.id))
      .slice(0, Math.max(0, limit));
  }

  public async getProduct(id: string): Promise<CatalogProduct | null> { return this.curated.getProduct(id); }
  public async recordFeedback(feedback: CatalogFeedback): Promise<void> { return this.curated.recordFeedback(feedback); }

  private reserveRemoteSearch(): boolean {
    // A shelf can include up to 12 detections. Keep public API use well below
    // Open Food Facts' documented per-minute limit and preserve scan latency.
    if (this.remoteSearches >= 3) return false;
    this.remoteSearches += 1;
    return true;
  }

  private async fetchOpenFoodFactsByBarcode(gtin: string): Promise<CatalogProduct | null> {
    if (!gtin) return null;
    const products = await this.cached(`off:barcode:${gtin}`, { source: "open_food_facts", operation: "barcode" }, async () => {
      const startedAt = Date.now();
      const result = await this.fetchOpenFoodFacts(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(gtin)}.json?fields=code,product_name,brands,quantity,nutriments`, {
        headers: { "user-agent": this.userAgent },
      });
      if (result.kind === "budget_exhausted") return this.logSourceBudgetExhausted({ source: "open_food_facts", operation: "barcode" }, startedAt);
      if (result.kind === "timeout" || result.kind === "http_error") return this.logSourceFailure({ source: "open_food_facts", operation: "barcode" }, result.kind, startedAt);
      if (!result.response.ok) return this.logSourceFailure({ source: "open_food_facts", operation: "barcode" }, "http_error", startedAt);
      try {
        const payload = await result.response.json() as { product?: OpenFoodFactsProduct };
        if (!payload || typeof payload !== "object") return this.logSourceFailure({ source: "open_food_facts", operation: "barcode" }, "invalid_payload", startedAt);
        const product = payload.product ? openFoodFactsProduct(payload.product, new Date().toISOString()) : null;
        this.logSourceSuccess({ source: "open_food_facts", operation: "barcode" }, startedAt, payload.product ? 1 : 0);
        return product ? [product] : [];
      } catch {
        return this.logSourceFailure({ source: "open_food_facts", operation: "barcode" }, "invalid_payload", startedAt);
      }
    });
    return products[0] ?? null;
  }

  private async searchOpenFoodFacts(query: string, limit: number): Promise<CatalogProduct[]> {
    return this.cached(`off:search:${query.toLowerCase()}:${limit}`, { source: "open_food_facts", operation: "search" }, async () => {
      const startedAt = Date.now();
      const params = new URLSearchParams({ search_terms: query, search_simple: "1", action: "process", json: "1", page_size: String(Math.min(limit, 3)), fields: "code,product_name,brands,quantity,nutriments" });
      const result = await this.fetchOpenFoodFacts(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, {
        headers: { "user-agent": this.userAgent },
      });
      if (result.kind === "budget_exhausted") return this.logSourceBudgetExhausted({ source: "open_food_facts", operation: "search" }, startedAt);
      if (result.kind === "timeout" || result.kind === "http_error") return this.logSourceFailure({ source: "open_food_facts", operation: "search" }, result.kind, startedAt);
      if (!result.response.ok) return this.logSourceFailure({ source: "open_food_facts", operation: "search" }, "http_error", startedAt);
      try {
        const payload = await result.response.json() as { products?: OpenFoodFactsProduct[] };
        if (!payload || !Array.isArray(payload.products)) return this.logSourceFailure({ source: "open_food_facts", operation: "search" }, "invalid_payload", startedAt);
        const observedAt = new Date().toISOString();
        const products = payload.products.map((product) => openFoodFactsProduct(product, observedAt)).filter((product): product is CatalogProduct => product !== null);
        this.logSourceSuccess({ source: "open_food_facts", operation: "search" }, startedAt, payload.products.length);
        return products;
      } catch {
        return this.logSourceFailure({ source: "open_food_facts", operation: "search" }, "invalid_payload", startedAt);
      }
    });
  }

  private async fetchUsdaByQuery(query: string, limit = 1): Promise<CatalogProduct[]> {
    const apiKey = this.options.usdaApiKey;
    if (!apiKey) {
      logCatalogSourceTelemetry({ source: "usda_food_data_central", operation: "search", outcome: "disabled", durationMs: 0, candidateCount: 0, cacheHit: false });
      return [];
    }
    return this.cached(`usda:search:${query.toLowerCase()}:${limit}`, { source: "usda_food_data_central", operation: "search" }, async () => {
      const startedAt = Date.now();
      const params = new URLSearchParams({ api_key: apiKey, query, dataType: "Branded", pageSize: String(Math.min(limit, 3)) });
      const result = await this.fetchWithTimeout(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`);
      if (result.kind !== "response") return this.logSourceFailure({ source: "usda_food_data_central", operation: "search" }, result.kind, startedAt);
      if (!result.response.ok) return this.logSourceFailure({ source: "usda_food_data_central", operation: "search" }, "http_error", startedAt);
      try {
        const payload = await result.response.json() as { foods?: UsdaFood[] };
        if (!payload || !Array.isArray(payload.foods)) return this.logSourceFailure({ source: "usda_food_data_central", operation: "search" }, "invalid_payload", startedAt);
        const observedAt = new Date().toISOString();
        const products = payload.foods.map((food) => usdaFoodProduct(food, observedAt)).filter((product): product is CatalogProduct => product !== null);
        this.logSourceSuccess({ source: "usda_food_data_central", operation: "search" }, startedAt, payload.foods.length);
        return products;
      } catch {
        return this.logSourceFailure({ source: "usda_food_data_central", operation: "search" }, "invalid_payload", startedAt);
      }
    });
  }

  private get userAgent(): string {
    return this.options.openFoodFactsUserAgent ?? "SugarShelfScanner/0.1 (https://sugar.no)";
  }

  /**
   * Public Open Food Facts has occasional transient gateway/rate-limit failures.
   * Give it one quick second chance, but keep both attempts inside the same
   * per-source deadline so a retry cannot make a shelf scan slower than budget.
   */
  private async fetchOpenFoodFacts(input: string, init?: RequestInit): Promise<RemoteFetchResult> {
    const deadlineAt = Date.now() + REMOTE_TIMEOUT_MS;
    if (!this.reserveOpenFoodFactsAttempt()) return { kind: "budget_exhausted" };
    let result = await this.fetchWithTimeout(input, init, deadlineAt);

    if (!this.shouldRetryOpenFoodFacts(result)) return result;

    // Do not start a retry unless there is enough deadline left for a small
    // backoff and a meaningful request. This preserves the original latency cap.
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= OPEN_FOOD_FACTS_RETRY_BACKOFF_MS + 100) return result;
    if (!this.reserveOpenFoodFactsAttempt()) return result;

    await this.sleep(Math.min(OPEN_FOOD_FACTS_RETRY_BACKOFF_MS, remainingMs - 100));
    result = await this.fetchWithTimeout(input, init, deadlineAt);
    return result;
  }

  private reserveOpenFoodFactsAttempt(): boolean {
    // `remoteSearches` remains the logical per-scan guard. This stricter
    // counter prevents a retry from silently increasing physical OFF traffic.
    if (this.openFoodFactsAttempts >= 3) return false;
    this.openFoodFactsAttempts += 1;
    return true;
  }

  private shouldRetryOpenFoodFacts(result: RemoteFetchResult): boolean {
    if (result.kind === "http_error") return true; // network failure; no response status is available
    if (result.kind !== "response") return false;
    return result.response.status === 429 || result.response.status >= 500;
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  private async fetchWithTimeout(input: string, init?: RequestInit, deadlineAt = Date.now() + REMOTE_TIMEOUT_MS): Promise<TimedFetchResult> {
    const controller = new AbortController();
    const remainingMs = Math.max(1, deadlineAt - Date.now());
    const timer = setTimeout(() => controller.abort(), remainingMs);
    try {
      return { kind: "response", response: await this.fetch(input, { ...init, signal: controller.signal }) };
    } catch (error) {
      return { kind: error instanceof Error && error.name === "AbortError" ? "timeout" : "http_error" };
    } finally {
      clearTimeout(timer);
    }
  }

  private logSourceSuccess(request: SourceRequest, startedAt: number, candidateCount: number) {
    logCatalogSourceTelemetry({ ...request, outcome: "success", durationMs: Date.now() - startedAt, candidateCount, cacheHit: false });
  }

  private logSourceFailure(request: SourceRequest, outcome: "http_error" | "timeout" | "invalid_payload", startedAt: number): CatalogProduct[] {
    logCatalogSourceTelemetry({ ...request, outcome, durationMs: Date.now() - startedAt, candidateCount: 0, cacheHit: false });
    return [];
  }

  private logSourceBudgetExhausted(request: SourceRequest, startedAt: number): CatalogProduct[] {
    // This is a local circuit-breaker, not an upstream error. Reuse the
    // existing safe `disabled` outcome rather than emitting product data.
    logCatalogSourceTelemetry({ ...request, outcome: "disabled", durationMs: Date.now() - startedAt, candidateCount: 0, cacheHit: false });
    return [];
  }

  private async cached(key: string, requestMetadata: SourceRequest, load: () => Promise<CatalogProduct[]>): Promise<CatalogProduct[]> {
    const now = Date.now();
    const existing = remoteCache.get(key);
    if (existing && existing.expiresAt > now) {
      logCatalogSourceTelemetry({ ...requestMetadata, outcome: "success", durationMs: 0, candidateCount: existing.value.length, cacheHit: true });
      return existing.value;
    }

    const pending = inFlightRemoteLoads.get(key);
    if (pending) {
      const value = await pending;
      logCatalogSourceTelemetry({ ...requestMetadata, outcome: "success", durationMs: 0, candidateCount: value.length, cacheHit: true });
      return value;
    }

    const request = load().catch(() => []).then((value) => {
      // Cache unsuccessful results briefly too. This provides a circuit-breaker
      // effect during an upstream outage without keeping a newly-added SKU stale.
      remoteCache.set(key, { value, expiresAt: now + (value.length ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS) });
      if (remoteCache.size > MAX_CACHE_ENTRIES) {
        const oldest = remoteCache.keys().next().value;
        if (oldest) remoteCache.delete(oldest);
      }
      return value;
    }).finally(() => {
      inFlightRemoteLoads.delete(key);
    });
    inFlightRemoteLoads.set(key, request);
    return request;
  }
}
