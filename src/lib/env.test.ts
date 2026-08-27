import assert from "node:assert/strict";
import test from "node:test";
import { isVisionUsageMetricsEnabled } from "./env";

test("vision usage metrics flag fails closed", () => {
  assert.equal(isVisionUsageMetricsEnabled({ ...process.env, VISION_USAGE_METRICS_ENABLED: undefined }), false);
  assert.equal(isVisionUsageMetricsEnabled({ ...process.env, VISION_USAGE_METRICS_ENABLED: "false" }), false);
  assert.equal(isVisionUsageMetricsEnabled({ ...process.env, VISION_USAGE_METRICS_ENABLED: "TRUE" }), false);
  assert.equal(isVisionUsageMetricsEnabled({ ...process.env, VISION_USAGE_METRICS_ENABLED: "true" }), true);
});
