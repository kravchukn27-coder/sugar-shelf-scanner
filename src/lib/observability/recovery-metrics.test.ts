import assert from "node:assert/strict";
import test from "node:test";
import { logRecoveryMetrics, recoveryMetricsSchema } from "./recovery-metrics";

const validMetric = {
  localBarcodeDecode: "decoded" as const,
};

test("recovery metrics accepts only the three known decode outcomes", () => {
  assert.deepEqual(recoveryMetricsSchema.parse(validMetric), validMetric);
  assert.deepEqual(recoveryMetricsSchema.parse({ localBarcodeDecode: "not_recognised" }), { localBarcodeDecode: "not_recognised" });
  assert.deepEqual(recoveryMetricsSchema.parse({ localBarcodeDecode: "reader_unavailable" }), { localBarcodeDecode: "reader_unavailable" });
  assert.equal(recoveryMetricsSchema.safeParse({ localBarcodeDecode: "found_it" }).success, false);
});

test("recovery metrics rejects identifiers and all unknown fields", () => {
  assert.equal(recoveryMetricsSchema.safeParse({ ...validMetric, scanId: "do-not-log" }).success, false);
  assert.equal(recoveryMetricsSchema.safeParse({ ...validMetric, barcode: "do-not-log" }).success, false);
  assert.equal(recoveryMetricsSchema.safeParse({ ...validMetric, imageBase64: "do-not-log" }).success, false);
});

test("recovery metrics logger emits only the allowlisted aggregate event", () => {
  const previousInfo = console.info;
  const entries: string[] = [];
  console.info = (entry: string) => entries.push(entry);
  try {
    logRecoveryMetrics(validMetric);
  } finally {
    console.info = previousInfo;
  }
  assert.deepEqual(JSON.parse(entries[0]), { event: "recovery_barcode_decode", ...validMetric });
});
