import assert from "node:assert/strict";
import test from "node:test";
import { isAnalyticsEnabled, listAnalyticsEvents, recordAnalyticsEvent, type AnalyticsQueryExecutor } from "./events";

function withAnalyticsEnvironment(value: string | undefined, run: () => Promise<void> | void) {
  const previousEnabled = process.env.ANALYTICS_ENABLED;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  if (value === undefined) delete process.env.ANALYTICS_ENABLED;
  else process.env.ANALYTICS_ENABLED = value;
  process.env.DATABASE_URL = "postgres://localhost:5432/sugar";
  return Promise.resolve(run()).finally(() => {
    if (previousEnabled === undefined) delete process.env.ANALYTICS_ENABLED;
    else process.env.ANALYTICS_ENABLED = previousEnabled;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });
}

test("analytics storage fails closed until explicitly enabled", () => {
  assert.equal(isAnalyticsEnabled({ DATABASE_URL: "postgres://localhost:5432/sugar" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(isAnalyticsEnabled({ ANALYTICS_ENABLED: "true" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(isAnalyticsEnabled({ ANALYTICS_ENABLED: "true", DATABASE_URL: "postgres://localhost:5432/sugar" } as unknown as NodeJS.ProcessEnv), true);
});

test("analytics repository inserts a parameterized event", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const executor: AnalyticsQueryExecutor = { query: async (text, values) => {
    calls.push({ text, values });
    return { rows: [] };
  } };

  await withAnalyticsEnvironment("true", async () => {
    assert.equal(await recordAnalyticsEvent({
      eventName: "scan_result_metric",
      source: "browser",
      properties: { action: "result_shown", resultQuality: "mixed" },
    }, executor), true);
  });

  assert.match(calls[0].text, /INSERT INTO analytics_events/);
  assert.deepEqual(calls[0].values?.slice(1), ["scan_result_metric", "browser", '{"action":"result_shown","resultQuality":"mixed"}', null]);
});

test("analytics reads use a bounded parameterized window", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const executor: AnalyticsQueryExecutor = { query: async (text, values) => {
    calls.push({ text, values });
    return { rows: [] };
  } };

  await withAnalyticsEnvironment("true", async () => {
    assert.deepEqual(await listAnalyticsEvents({
      since: new Date("2026-08-31T00:00:00Z"),
      eventNames: ["vision_usage"],
      limit: 99_999,
    }, executor), []);
  });

  assert.match(calls[0].text, /event_name = ANY\(\$3::text\[\]\)/);
  assert.equal(calls[0].values?.at(-1), 10_000);
});
