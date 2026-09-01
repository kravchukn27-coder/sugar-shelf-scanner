import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  isPaidCheckoutEvent,
  parseStripeWebhookEvent,
  toStripePaymentLedgerEntry,
  verifyStripeWebhookSignature,
} from "./stripe-webhook";

const SECRET = "whsec_example";
const NOW = new Date("2026-09-02T12:00:00.000Z");

function signature(payload: string, timestamp = "1788350400") {
  const digest = createHmac("sha256", SECRET).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_checkout_completed",
    type: "checkout.session.completed",
    created: 1_788_350_400,
    data: {
      object: {
        id: "cs_test_abc123",
        payment_intent: "pi_test_123",
        customer: "cus_test_123",
        payment_status: "paid",
        amount_total: 299,
        currency: "usd",
        customer_details: { email: "buyer@example.com" },
        ...overrides,
      },
    },
  });
}

test("Stripe signature accepts a current v1 signature and rejects altered or stale deliveries", () => {
  const payload = checkoutEvent();
  assert.equal(verifyStripeWebhookSignature(payload, signature(payload), SECRET, NOW), true);
  assert.equal(verifyStripeWebhookSignature(`${payload} `, signature(payload), SECRET, NOW), false);
  assert.equal(verifyStripeWebhookSignature(payload, "t=1788340000,v1=deadbeef", SECRET, NOW), false);
  assert.equal(verifyStripeWebhookSignature(payload, null, SECRET, NOW), false);
});

test("checkout events become compact ledger facts and identify a paid access grant", () => {
  const payload = JSON.parse(checkoutEvent()) as Record<string, unknown>;
  // Stripe's normal event envelope has many fields beyond the few this service
  // needs. They must not make an otherwise valid signed delivery fail.
  payload.api_version = "2025-08-27.basil";
  payload.livemode = true;
  const event = parseStripeWebhookEvent(JSON.stringify(payload));
  assert.ok(event);
  const entry = toStripePaymentLedgerEntry(event);
  assert.deepEqual(entry, {
    stripeEventId: "evt_checkout_completed",
    eventType: "checkout.session.completed",
    eventCreatedAt: "2026-09-02T12:00:00.000Z",
    checkoutSessionId: "cs_test_abc123",
    paymentIntentId: "pi_test_123",
    customerId: "cus_test_123",
    paymentStatus: "paid",
    amountTotal: 299,
    amountRefunded: null,
    currency: "usd",
    email: "buyer@example.com",
  });
  assert.equal(entry && isPaidCheckoutEvent(entry), true);
});

test("refund events retain refund facts without readable billing details", () => {
  const payload = JSON.stringify({
    id: "evt_refund",
    type: "charge.refunded",
    created: 1_788_350_400,
    data: { object: { id: "ch_123", payment_intent: "pi_test_123", customer: "cus_test_123", amount: 299, amount_refunded: 299, currency: "usd" } },
  });
  const event = parseStripeWebhookEvent(payload);
  assert.ok(event);
  assert.deepEqual(toStripePaymentLedgerEntry(event), {
    stripeEventId: "evt_refund",
    eventType: "charge.refunded",
    eventCreatedAt: "2026-09-02T12:00:00.000Z",
    checkoutSessionId: null,
    paymentIntentId: "pi_test_123",
    customerId: "cus_test_123",
    paymentStatus: "refunded",
    amountTotal: 299,
    amountRefunded: 299,
    currency: "usd",
    email: null,
  });
});

test("malformed or unrelated Stripe payloads are not accepted as payment facts", () => {
  assert.equal(parseStripeWebhookEvent("not json"), null);
  const unrelated = parseStripeWebhookEvent(JSON.stringify({
    id: "evt_other", type: "customer.created", created: 1_788_350_400, data: { object: {} },
  }));
  assert.ok(unrelated);
  assert.equal(toStripePaymentLedgerEntry(unrelated), null);
  const incomplete = parseStripeWebhookEvent(checkoutEvent({ payment_status: "unpaid" }));
  assert.ok(incomplete);
  const entry = toStripePaymentLedgerEntry(incomplete);
  assert.ok(entry);
  assert.equal(isPaidCheckoutEvent(entry), false);
});
