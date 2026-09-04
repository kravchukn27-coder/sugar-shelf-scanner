import { createSign } from "node:crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const BIGQUERY_SCOPE = "https://www.googleapis.com/auth/bigquery";
const CACHE_MS = 10 * 60_000;
const STALE_AFTER_MS = 36 * 60 * 60_000;
const DAILY_WINDOW_DAYS = 28;

export type CloudBillingDailyCost = { day: string; costUsd: number };

export type CloudBillingSummary = {
  state: "not_configured" | "waiting_for_export" | "no_data" | "stale" | "available" | "unavailable";
  currency: string | null;
  actualGoogleLast24Hours: number | null;
  actualGoogleLast30Days: number | null;
  geminiLast24Hours: number | null;
  geminiLast7Days: number | null;
  geminiLast30Days: number | null;
  geminiMonthToDate: number | null;
  latestUsageAt: string | null;
  // Last DAILY_WINDOW_DAYS days of Gemini-only spend, oldest first -- feeds
  // the daily spend chart. Empty rather than null when there is simply no
  // cost yet, so the chart can render a flat/empty state instead of an
  // error state.
  dailyGeminiCostUsd: CloudBillingDailyCost[];
  // Google has no public API for the AI Studio "monthly spend cap" or
  // prepay balance (confirmed against the Gemini API billing docs,
  // 2026-09-04) -- this is read from an env var the operator sets to match
  // whatever they configured in AI Studio, not fetched live from Google.
  monthlySpendCapUsd: number | null;
};

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
type FetchLike = typeof fetch;
type Cache = { value?: CloudBillingSummary; expiresAt?: number };
const globalCache = globalThis as typeof globalThis & { __sugarCloudBillingCache?: Cache };

function unavailable(state: CloudBillingSummary["state"], monthlySpendCapUsd: number | null): CloudBillingSummary {
  return { state, currency: null, actualGoogleLast24Hours: null, actualGoogleLast30Days: null, geminiLast24Hours: null, geminiLast7Days: null, geminiLast30Days: null, geminiMonthToDate: null, latestUsageAt: null, dailyGeminiCostUsd: [], monthlySpendCapUsd };
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

function positiveAmount(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

async function runQuery(projectId: string, token: string, fetcher: FetchLike, query: string): Promise<{ jobComplete?: boolean; rows?: Array<{ f?: Array<{ v?: unknown }> }> } | null> {
  const response = await fetcher(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({ query, useLegacySql: false, parameterMode: "NAMED", queryParameters: [{ name: "projectId", parameterType: { type: "STRING" }, parameterValue: { value: projectId } }] }),
  });
  const result = await response.json().catch(() => null) as { jobComplete?: boolean; rows?: Array<{ f?: Array<{ v?: unknown }> }> } | null;
  return response.ok ? result : null;
}

function summaryQuery(projectId: string, datasetId: string, tableId: string) {
  return `
    WITH source AS (
      SELECT currency, usage_start_time, usage_end_time,
        cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) credit), 0) AS net_cost,
        REGEXP_CONTAINS(LOWER(CONCAT(service.description, " ", sku.description)), r"gemini|generative language") AS is_gemini
      FROM \`${projectId}.${datasetId}.${tableId}\`
      WHERE project.id = @projectId
        AND usage_start_time >= LEAST(TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY), TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH))
    )
    SELECT currency, MAX(usage_end_time) AS latest_usage_at,
      SUM(IF(usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY), net_cost, 0)) AS google_24h,
      SUM(net_cost) AS google_30d,
      SUM(IF(is_gemini AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY), net_cost, 0)) AS gemini_24h,
      SUM(IF(is_gemini AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY), net_cost, 0)) AS gemini_7d,
      SUM(IF(is_gemini, net_cost, 0)) AS gemini_30d,
      SUM(IF(is_gemini AND usage_start_time >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH), net_cost, 0)) AS gemini_month_to_date
    FROM source GROUP BY currency ORDER BY google_30d DESC LIMIT 1`;
}

function dailyGeminiCostQuery(projectId: string, datasetId: string, tableId: string) {
  return `
    SELECT DATE(usage_start_time) AS day,
      SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) credit), 0)) AS net_cost
    FROM \`${projectId}.${datasetId}.${tableId}\`
    WHERE project.id = @projectId
      AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${DAILY_WINDOW_DAYS} DAY)
      AND REGEXP_CONTAINS(LOWER(CONCAT(service.description, " ", sku.description)), r"gemini|generative language")
    GROUP BY day ORDER BY day ASC`;
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
  const monthlySpendCapUsd = positiveAmount(environment.GEMINI_MONTHLY_SPEND_CAP_USD);
  const projectId = environment.GOOGLE_CLOUD_BILLING_PROJECT_ID;
  const datasetId = environment.GOOGLE_CLOUD_BILLING_DATASET_ID;
  const account = parseServiceAccount(environment.GOOGLE_CLOUD_BILLING_SERVICE_ACCOUNT_JSON_BASE64);
  if (!validProjectId(projectId) || !validDatasetId(datasetId) || !account) return unavailable("not_configured", monthlySpendCapUsd);
  if (cache.value && (cache.expiresAt ?? 0) > now.getTime()) return cache.value;
  const cacheResult = (value: CloudBillingSummary) => {
    cache.value = value;
    cache.expiresAt = now.getTime() + CACHE_MS;
    return value;
  };

  try {
    const token = await accessToken(account, now, fetcher);
    if (!token) return cacheResult(unavailable("unavailable", monthlySpendCapUsd));
    const tables = await requestJson(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables`, token, fetcher) as { tables?: Array<{ tableReference?: { tableId?: string }; type?: string }> } | null;
    const tableId = tables?.tables?.filter((table) => table.type === "TABLE" && /^gcp_billing_export_v1_[A-Za-z0-9_]+$/.test(table.tableReference?.tableId ?? "")).map((table) => table.tableReference?.tableId as string).sort().at(-1);
    if (!tableId) return cacheResult(unavailable("waiting_for_export", monthlySpendCapUsd));

    const summaryResult = await runQuery(projectId, token, fetcher, summaryQuery(projectId, datasetId, tableId));
    if (!summaryResult || summaryResult.jobComplete === false) return cacheResult(unavailable("unavailable", monthlySpendCapUsd));
    const row = summaryResult.rows?.[0];
    if (!row) return cacheResult(unavailable("no_data", monthlySpendCapUsd));

    const dailyResult = await runQuery(projectId, token, fetcher, dailyGeminiCostQuery(projectId, datasetId, tableId));
    const dailyGeminiCostUsd: CloudBillingDailyCost[] = dailyResult?.jobComplete === false ? [] : (dailyResult?.rows ?? []).map((dailyRow) => ({ day: field(dailyRow, 0) ?? "", costUsd: numberField(dailyRow, 1) ?? 0 })).filter((entry) => entry.day);

    const latestUsageAt = field(row, 1);
    const latestUsageMs = latestUsageAt ? Date.parse(latestUsageAt) : Number.NaN;
    const state = !Number.isFinite(latestUsageMs) || now.getTime() - latestUsageMs > STALE_AFTER_MS ? "stale" : "available";
    return cacheResult({
      state,
      currency: field(row, 0),
      latestUsageAt,
      actualGoogleLast24Hours: numberField(row, 2),
      actualGoogleLast30Days: numberField(row, 3),
      geminiLast24Hours: numberField(row, 4),
      geminiLast7Days: numberField(row, 5),
      geminiLast30Days: numberField(row, 6),
      geminiMonthToDate: numberField(row, 7),
      dailyGeminiCostUsd,
      monthlySpendCapUsd,
    });
  } catch {
    return cacheResult(unavailable("unavailable", monthlySpendCapUsd));
  }
}
