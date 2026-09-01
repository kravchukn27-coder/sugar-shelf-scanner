import assert from "node:assert/strict";
import test from "node:test";
import { recordStripePaymentEvent } from "./stripe-ledger";

test("Stripe payment ledger writes compact, idempotent event facts", async () => {
  let statement = "";
  let parameters: readonly unknown[] = [];
  const db = {
    async query(sql: string, values: readonly unknown[] = []) {
      statement = sql;
      parameters = values;
      return { rows: [] };
    },
  };
  await recordStripePaymentEvent(db, {
    stripeEventId: "evt_123",
    eventType: "checkout.session.completed",
    eventCreatedAt: "2026-09-02T12:00:00.000Z",
    checkoutSessionId: "cs_test_123",
    paymentIntentId: "pi_123",
    customerId: "cus_123",
    paymentStatus: "paid",
    amountTotal: 299,
    amountRefunded: null,
    currency: "usd",
    email: "buyer@example.com",
  }, "digest", new Date("2026-09-02T12:01:00.000Z"));
  assert.match(statement, /ON CONFLICT \(stripe_event_id\) DO NOTHING/);
  assert.deepEqual(parameters, [
    "evt_123", "checkout.session.completed", "2026-09-02T12:00:00.000Z", "2026-09-02T12:01:00.000Z",
    "cs_test_123", "pi_123", "cus_123", "paid", 299, null, "usd", "digest",
  ]);
  assert.equal(parameters.includes("buyer@example.com"), false);
});
