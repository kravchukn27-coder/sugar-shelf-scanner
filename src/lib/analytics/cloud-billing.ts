import { createSign } from "node:crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const BIGQUERY_SCOPE = "https://www.googleapis.com/auth/bigquery";
const CACHE_MS = 10 * 60_000;
const STALE_AFTER_MS = 36 * 60 * 60_000;

export type CloudBillingSummary = {
  state: "not_configured" | "waiting_for_export" | "no_data" | "stale" | "available" | "unavailable";
  currency: string | null;
  actualGoogleLast24Hours: number | null;
  actualGoogleLast30Days: number | null;
  geminiLast24Hours: number | null;
  geminiLast30Days: number | null;
  latestUsageAt: string | null;
};

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
type FetchLike = typeof fetch;
type Cache = { value?: CloudBillingSummary; expiresAt?: number };
const globalCache = globalThis as typeof globalThis & { __sugarCloudBillingCache?: Cache };

function unavailable(): CloudBillingSummary {
  return { state: "unavailable", currency: null, actualGoogleLast24Hours: null, actualGoogleLast30Days: null, geminiLast24Hours: null, geminiLast30Days: null, latestUsageAt: null };
}

function notConfigured(): CloudBillingSummary {
  return { ...unavailable(), state: "not_configured" };
}

function waitingForExport(): CloudBillingSummary {
  return { ...unavailable(), state: "waiting_for_export" };
}

function noData(): CloudBillingSummary {
  return { ...unavailable(), state: "no_data" };
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function parseServiceAccount(encoded: string | undefined): ServiceAccount | null {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key || (parsed.token_uri && parsed.token_uri !== GOOGLE_TOKEN_URL)) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: GOOGLE_TOKEN_URL };
  } catch {
    return null;
  }
}

function validProjectId(value: string | undefined): value is string {
  return Boolean(value && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value));
}

function validDatasetId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/.test(value));
}

async function accessToken(account: ServiceAccount, now: Date, fetcher: FetchLike): Promise<string | null> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({ iss: account.client_email, scope: BIGQUERY_SCOPE, aud: GOOGLE_TOKEN_URL, iat: issuedAt, exp: issuedAt + 3600 }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key).toString("base64url")}`;
  const response = await fetcher(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(6_000) });
  const body = await response.json().catch(() => null) as { access_token?: unknown } | null;
  return response.ok && typeof body?.access_token === "string" ? body.access_token : null;
}

async function requestJson(url: string, token: string, fetcher: FetchLike): Promise<unknown | null> {
  const response = await fetcher(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6_000) });
  return response.ok ? response.json().catch(() => null) : null;
}

function billingQuery(projectId: string, datasetId: string, tableId: string) {
  return `
    WITH source AS (
      SELECT currency, usage_start_time, usage_end_time,
        cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) credit), 0) AS net_cost,
        REGEXP_CONTAINS(LOWER(CONCAT(service.description, " ", sku.description)), r"gemini|generative language") AS is_gemini
      FROM \`${projectId}.${datasetId}.${tableId}\`
      WHERE project.id = @projectId
        AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
    )
    SELECT currency, MAX(usage_end_time) AS latest_usage_at,
      SUM(IF(usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY), net_cost, 0)) AS google_24h,
      SUM(net_cost) AS google_30d,
      SUM(IF(is_gemini AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY), net_cost, 0)) AS gemini_24h,
      SUM(IF(is_gemini, net_cost, 0)) AS gemini_30d
    FROM source GROUP BY currency ORDER BY google_30d DESC LIMIT 1`;
}

function field(row: { f?: Array<{ v?: unknown }> } | undefined, index: number): string | null {
  const value = row?.f?.[index]?.v;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function numberField(row: { f?: Array<{ v?: unknown }> } | undefined, index: number): number | null {
  const value = Number(field(row, index));
  return Number.isFinite(value) ? value : null;
}

export async function readCloudBillingSummary(
  environment: NodeJS.ProcessEnv = process.env,
  now = new Date(),
  fetcher: FetchLike = fetch,
  cache: Cache = globalCache.__sugarCloudBillingCache ??= {},
): Promise<CloudBillingSummary> {
  const projectId = environment.GOOGLE_CLOUD_BILLING_PROJECT_ID;
  const datasetId = environment.GOOGLE_CLOUD_BILLING_DATASET_ID;
  const account = parseServiceAccount(environment.GOOGLE_CLOUD_BILLING_SERVICE_ACCOUNT_JSON_BASE64);
  if (!validProjectId(projectId) || !validDatasetId(datasetId) || !account) return notConfigured();
  if (cache.value && (cache.expiresAt ?? 0) > now.getTime()) return cache.value;
  const cacheResult = (value: CloudBillingSummary) => {
    cache.value = value;
    cache.expiresAt = now.getTime() + CACHE_MS;
    return value;
  };

  try {
    const token = await accessToken(account, now, fetcher);
    if (!token) return cacheResult(unavailable());
    const tables = await requestJson(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables`, token, fetcher) as { tables?: Array<{ tableReference?: { tableId?: string }; type?: string }> } | null;
    const tableId = tables?.tables?.filter((table) => table.type === "TABLE" && /^gcp_billing_export_v1_[A-Za-z0-9_]+$/.test(table.tableReference?.tableId ?? "")).map((table) => table.tableReference?.tableId as string).sort().at(-1);
    if (!tableId) return cacheResult(waitingForExport());

    const response = await fetcher(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ query: billingQuery(projectId, datasetId, tableId), useLegacySql: false, parameterMode: "NAMED", queryParameters: [{ name: "projectId", parameterType: { type: "STRING" }, parameterValue: { value: projectId } }] }),
    });
    const result = await response.json().catch(() => null) as { jobComplete?: boolean; rows?: Array<{ f?: Array<{ v?: unknown }> }> } | null;
    if (!response.ok || result?.jobComplete === false) return cacheResult(unavailable());
    const row = result?.rows?.[0];
    if (!row) return cacheResult(noData());
    const latestUsageAt = field(row, 1);
    const latestUsageMs = latestUsageAt ? Date.parse(latestUsageAt) : Number.NaN;
    const state = !Number.isFinite(latestUsageMs) || now.getTime() - latestUsageMs > STALE_AFTER_MS ? "stale" : "available";
    return cacheResult({ state, currency: field(row, 0), latestUsageAt, actualGoogleLast24Hours: numberField(row, 2), actualGoogleLast30Days: numberField(row, 3), geminiLast24Hours: numberField(row, 4), geminiLast30Days: numberField(row, 5) });
  } catch {
    return cacheResult(unavailable());
  }
}
