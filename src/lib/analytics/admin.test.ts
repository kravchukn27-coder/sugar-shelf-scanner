import assert from "node:assert/strict";
import test from "node:test";
import { isAnalyticsAdminRequest, isAnalyticsDashboardConfigured, type AnalyticsEnvironment } from "./admin";

const secret = "a-secure-dashboard-secret";

test("analytics admin authentication accepts only the configured bearer secret", () => {
  const environment = { ANALYTICS_ADMIN_SECRET: secret } as AnalyticsEnvironment;
  assert.equal(isAnalyticsAdminRequest(new Request("http://localhost", { headers: { authorization: `Bearer ${secret}` } }), environment), true);
  assert.equal(isAnalyticsAdminRequest(new Request("http://localhost", { headers: { authorization: "Bearer incorrect-dashboard-secret" } }), environment), false);
  assert.equal(isAnalyticsAdminRequest(new Request("http://localhost"), environment), false);
});

test("analytics dashboard requires enabled storage and an admin secret", () => {
  assert.equal(isAnalyticsDashboardConfigured({ ANALYTICS_ENABLED: "true", DATABASE_URL: "postgres://example", ANALYTICS_ADMIN_SECRET: secret } as AnalyticsEnvironment), true);
  assert.equal(isAnalyticsDashboardConfigured({ ANALYTICS_ENABLED: "false", DATABASE_URL: "postgres://example", ANALYTICS_ADMIN_SECRET: secret } as AnalyticsEnvironment), false);
  assert.equal(isAnalyticsDashboardConfigured({ ANALYTICS_ENABLED: "true", DATABASE_URL: "postgres://example" } as AnalyticsEnvironment), false);
});
