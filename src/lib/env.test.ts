import assert from "node:assert/strict";
import test from "node:test";
import { getAccessPassConfig, getStripeWebhookConfig, isVisionUsageMetricsEnabled } from "./env";

test("vision usage metrics flag fails closed", () => {
  assert.equal(isVisionUsageMetricsEnabled({ ...process.env, VISION_USAGE_METRICS_ENABLED: undefined }), false);
  assert.equal(isVisionUsageMetricsEnabled({ ...process.env, VISION_USAGE_METRICS_ENABLED: "false" }), false);
  assert.equal(isVisionUsageMetricsEnabled({ ...process.env, VISION_USAGE_METRICS_ENABLED: "TRUE" }), false);
  assert.equal(isVisionUsageMetricsEnabled({ ...process.env, VISION_USAGE_METRICS_ENABLED: "true" }), true);
});

const completeAccessEnv = {
  ...process.env,
  STRIPE_SECRET_KEY: "sk_test_example",
  ACCESS_PASS_SECRET: "0123456789abcdef01",
  DATABASE_URL: "postgres://localhost:5432/sugar",
};

test("access pass config fails closed when anything is missing", () => {
  assert.deepEqual(getAccessPassConfig(completeAccessEnv), {
    stripeSecretKey: "sk_test_example",
    accessPassSecret: "0123456789abcdef01",
    databaseUrl: "postgres://localhost:5432/sugar",
  });
  assert.equal(getAccessPassConfig({ ...completeAccessEnv, STRIPE_SECRET_KEY: undefined }), null);
  assert.equal(getAccessPassConfig({ ...completeAccessEnv, DATABASE_URL: undefined }), null);
  // A short secret would weaken the email digest, so it is treated as absent.
  assert.equal(getAccessPassConfig({ ...completeAccessEnv, ACCESS_PASS_SECRET: "tooshort" }), null);
});

test("Stripe webhook config requires its independent signing secret", () => {
  const completeWebhookEnv = { ...completeAccessEnv, STRIPE_WEBHOOK_SECRET: "whsec_example" };
  assert.deepEqual(getStripeWebhookConfig(completeWebhookEnv), {
    stripeWebhookSecret: "whsec_example",
    accessPassSecret: "0123456789abcdef01",
    databaseUrl: "postgres://localhost:5432/sugar",
  });
  assert.equal(getStripeWebhookConfig({ ...completeWebhookEnv, STRIPE_WEBHOOK_SECRET: undefined }), null);
  assert.equal(getStripeWebhookConfig({ ...completeWebhookEnv, ACCESS_PASS_SECRET: "short" }), null);
});
