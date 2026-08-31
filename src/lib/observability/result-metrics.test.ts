import assert from "node:assert/strict";
import test from "node:test";
import { logResultMetrics, resultMetricsSchema } from "./result-metrics";

const resultShown = {
  action: "result_shown" as const,
  resultQuality: "mixed" as const,
  detectionCountBucket: "2_5" as const,
};

test("result metrics accepts only documented aggregate funnel actions", () => {
  assert.deepEqual(resultMetricsSchema.parse({ action: "scan_started" }), { action: "scan_started" });
  assert.deepEqual(resultMetricsSchema.parse(resultShown), resultShown);
  assert.deepEqual(resultMetricsSchema.parse({ action: "scan_abandoned", abandonmentStage: "analysis" }), {
    action: "scan_abandoned",
    abandonmentStage: "analysis",
  });
  assert.equal(resultMetricsSchema.safeParse({ action: "result_shown", resultQuality: "mixed" }).success, false);
  assert.equal(resultMetricsSchema.safeParse({ action: "scan_retried", resultQuality: "mixed" }).success, false);
});

test("result metrics rejects identifiers, product information, and unknown fields", () => {
  assert.equal(resultMetricsSchema.safeParse({ ...resultShown, scanId: "do-not-log" }).success, false);
  assert.equal(resultMetricsSchema.safeParse({ ...resultShown, productName: "do-not-log" }).success, false);
  assert.equal(resultMetricsSchema.safeParse({ ...resultShown, barcode: "do-not-log" }).success, false);
  assert.equal(resultMetricsSchema.safeParse({ ...resultShown, occurredAt: "do-not-log" }).success, false);
});

test("result metrics logger emits only the allowlisted aggregate event", () => {
  const previousInfo = console.info;
  const entries: string[] = [];
  console.info = (entry: string) => entries.push(entry);
  try {
    logResultMetrics(resultShown);
  } finally {
    console.info = previousInfo;
  }
  assert.deepEqual(JSON.parse(entries[0]), { event: "scan_result_metric", ...resultShown });
});

test("paywall funnel events are accepted with no identifiers", () => {
  assert.equal(resultMetricsSchema.safeParse({ action: "paywall_shown" }).success, true);
  assert.equal(resultMetricsSchema.safeParse({ action: "paywall_checkout_started" }).success, true);
  assert.equal(resultMetricsSchema.safeParse({ action: "access_granted", grantSource: "checkout" }).success, true);
  assert.equal(resultMetricsSchema.safeParse({ action: "access_granted", grantSource: "restore" }).success, true);
});

test("paywall events reject unknown fields and free-form values", () => {
  // The buyer's address, a token, or a price must never become a log line.
  assert.equal(resultMetricsSchema.safeParse({ action: "paywall_shown", email: "buyer@example.com" }).success, false);
  assert.equal(resultMetricsSchema.safeParse({ action: "access_granted" }).success, false);
  assert.equal(resultMetricsSchema.safeParse({ action: "access_granted", grantSource: "gift" }).success, false);
});
