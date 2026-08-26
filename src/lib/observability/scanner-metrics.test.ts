import assert from "node:assert/strict";
import test from "node:test";
import { logScannerMetrics, scannerMetricsSchema } from "./scanner-metrics";

const validMetric = {
  completion: "analysis_completed" as const,
  captureReadyMs: 125,
  captureEncodeMs: 50,
  preflightRttMs: 250,
  analyzeRttMs: 1_000,
  renderMs: 75,
  preflightAttempts: 2,
  qualitySkipped: 1,
};

test("scanner metrics accepts only capped 25ms aggregate buckets", () => {
  assert.deepEqual(scannerMetricsSchema.parse(validMetric), validMetric);
  assert.equal(scannerMetricsSchema.safeParse({ ...validMetric, analyzeRttMs: 1_001 }).success, false);
  assert.equal(scannerMetricsSchema.safeParse({ ...validMetric, renderMs: 60_025 }).success, false);
  assert.equal(scannerMetricsSchema.safeParse({ ...validMetric, preflightAttempts: 91 }).success, false);
});

test("scanner metrics rejects identifiers and all unknown fields", () => {
  assert.equal(scannerMetricsSchema.safeParse({ ...validMetric, scanId: "do-not-log" }).success, false);
  assert.equal(scannerMetricsSchema.safeParse({ ...validMetric, clientFrameId: "frame-1" }).success, false);
  assert.equal(scannerMetricsSchema.safeParse({ ...validMetric, imageBase64: "do-not-log" }).success, false);
});

test("scanner metrics logger emits only the allowlisted aggregate event", () => {
  const previousInfo = console.info;
  const entries: string[] = [];
  console.info = (entry: string) => entries.push(entry);
  try {
    logScannerMetrics(validMetric);
  } finally {
    console.info = previousInfo;
  }
  assert.deepEqual(JSON.parse(entries[0]), { event: "scanner_completed", ...validMetric });
});
