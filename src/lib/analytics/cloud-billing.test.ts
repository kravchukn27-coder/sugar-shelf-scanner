import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { readCloudBillingSummary } from "./cloud-billing";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = Buffer.from(JSON.stringify({ client_email: "billing-reader@example.iam.gserviceaccount.com", private_key: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })).toString("base64");
const environment = { GOOGLE_CLOUD_BILLING_PROJECT_ID: "gen-lang-client-0349591718", GOOGLE_CLOUD_BILLING_DATASET_ID: "sugar_billing", GOOGLE_CLOUD_BILLING_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount } as unknown as NodeJS.ProcessEnv;

test("cloud billing fails closed until project, dataset, and service account are configured", async () => {
  assert.equal((await readCloudBillingSummary({} as NodeJS.ProcessEnv, new Date(), fetch, {})).state, "not_configured");
});

test("cloud billing reads the operator-configured spend cap even when otherwise unconfigured", async () => {
  const result = await readCloudBillingSummary({ GEMINI_MONTHLY_SPEND_CAP_USD: "10" } as unknown as NodeJS.ProcessEnv, new Date(), fetch, {});
  assert.equal(result.state, "not_configured");
  assert.equal(result.monthlySpendCapUsd, 10);
});

test("cloud billing reports that export tables are not available yet", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return calls === 1 ? new Response(JSON.stringify({ access_token: "token" })) : new Response(JSON.stringify({ tables: [] }));
  }) as typeof fetch;
  assert.equal((await readCloudBillingSummary(environment, new Date(), fetcher, {})).state, "waiting_for_export");
});

test("cloud billing reads an aggregate Gemini and Google spend summary plus the daily breakdown", async () => {
  let calls = 0;
  let summaryQueryText = "";
  let dailyQueryText = "";
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ access_token: "token" }));
    if (calls === 2) return new Response(JSON.stringify({ tables: [{ type: "TABLE", tableReference: { tableId: "gcp_billing_export_v1_AAA_BBB_CCC" } }] }));
    if (calls === 3) {
      summaryQueryText = JSON.parse(String(init?.body)).query;
      return new Response(JSON.stringify({ rows: [{ f: [{ v: "USD" }, { v: "2026-08-31T10:00:00Z" }, { v: "1.25" }, { v: "15.5" }, { v: "1" }, { v: "5" }, { v: "12" }, { v: "2.41" }] }] }));
    }
    dailyQueryText = JSON.parse(String(init?.body)).query;
    return new Response(JSON.stringify({ rows: [{ f: [{ v: "2026-08-30" }, { v: "0.61" }] }, { f: [{ v: "2026-08-31" }, { v: "0.4" }] }] }));
  }) as typeof fetch;
  // Fixed clock on purpose: "available" versus "stale" is decided by how far
  // `now` sits from the row's usage timestamp, so a real clock made this test
  // pass only for the 36 hours after the fixture's date and fail every day
  // after that.
  const result = await readCloudBillingSummary({ ...environment, GEMINI_MONTHLY_SPEND_CAP_USD: "10" } as unknown as NodeJS.ProcessEnv, new Date("2026-08-31T12:00:00Z"), fetcher, {});
  assert.deepEqual(result, {
    state: "available",
    currency: "USD",
    latestUsageAt: "2026-08-31T10:00:00Z",
    actualGoogleLast24Hours: 1.25,
    actualGoogleLast30Days: 15.5,
    geminiLast24Hours: 1,
    geminiLast7Days: 5,
    geminiLast30Days: 12,
    geminiMonthToDate: 2.41,
    dailyGeminiCostUsd: [{ day: "2026-08-30", costUsd: 0.61 }, { day: "2026-08-31", costUsd: 0.4 }],
    monthlySpendCapUsd: 10,
  });
  assert.match(summaryQueryText, /project\.id = @projectId/);
  assert.match(summaryQueryText, /gemini\|generative language/);
  assert.match(dailyQueryText, /GROUP BY day ORDER BY day ASC/);
});

test("cloud billing distinguishes an empty table, stale data, and caches failures", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ access_token: "token" }));
    if (calls === 2) return new Response(JSON.stringify({ tables: [{ type: "TABLE", tableReference: { tableId: "gcp_billing_export_v1_AAA_BBB_CCC" } }] }));
    return new Response(JSON.stringify({ rows: [] }));
  }) as typeof fetch;
  const cache = {};
  assert.equal((await readCloudBillingSummary(environment, new Date("2026-08-31T12:00:00Z"), fetcher, cache)).state, "no_data");
  assert.equal((await readCloudBillingSummary(environment, new Date("2026-08-31T12:01:00Z"), fetcher, cache)).state, "no_data");
  assert.equal(calls, 3);
});

test("cloud billing preserves but marks an export older than 36 hours stale", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ access_token: "token" }));
    if (calls === 2) return new Response(JSON.stringify({ tables: [{ type: "TABLE", tableReference: { tableId: "gcp_billing_export_v1_AAA_BBB_CCC" } }] }));
    if (calls === 3) return new Response(JSON.stringify({ rows: [{ f: [{ v: "USD" }, { v: "2026-08-29T00:00:00Z" }, { v: "0" }, { v: "4" }, { v: "0" }, { v: "1" }, { v: "4" }, { v: "1" }] }] }));
    return new Response(JSON.stringify({ rows: [] }));
  }) as typeof fetch;
  const result = await readCloudBillingSummary(environment, new Date("2026-08-31T12:00:00Z"), fetcher, {});
  assert.equal(result.state, "stale");
  assert.equal(result.actualGoogleLast30Days, 4);
});
