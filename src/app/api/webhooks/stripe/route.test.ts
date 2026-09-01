import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { handleStripeWebhook } from "@/lib/access/stripe-webhook-handler";
import type { SqlQueryExecutor } from "@/lib/catalog/repository";
import { POST } from "./route";

const ENV_KEYS = ["STRIPE_WEBHOOK_SECRET", "ACCESS_PASS_SECRET", "DATABASE_URL"] as const;

function signedRequest(payload: string, secret = "whsec_example") {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: payload,
  });
}

async function withWebhookEnv(run: () => Promise<void>) {
  const previous = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
  process.env.ACCESS_PASS_SECRET = "0123456789abcdef01";
  process.env.DATABASE_URL = "postgres://localhost:5432/sugar";
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function paidCheckoutPayload() {
  return JSON.stringify({
    id: "evt_checkout_123",
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
      },
    },
  });
}

function handlerDependencies(query: (sql: string, values: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) {
  const executor: SqlQueryExecutor = {
    async query<Row extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
      const result = await query(sql, values);
      return { rows: result.rows as Row[] };
    },
  };
  return {
    getConfig: () => ({
      stripeWebhookSecret: "whsec_example",
      accessPassSecret: "0123456789abcdef01",
      databaseUrl: "postgres://localhost:5432/sugar",
    }),
    getPool: () => executor,
    now: () => new Date("2026-09-02T12:01:00.000Z"),
  };
}

test("Stripe webhook fails closed before setup", async () => {
  const previous = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_KEYS) delete process.env[key];
  try {
    const response = await POST(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}" }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Stripe webhook rejects an unsigned delivery before reaching the database", async () => {
  await withWebhookEnv(async () => {
    const response = await POST(signedRequest("{}", "wrong-secret"));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
});

test("a signed paid Checkout delivery writes the ledger and issues one idempotent pass", async () => {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const pass = { token: "a".repeat(48), expires_at: "2026-09-09T12:01:00.000Z" };
  const query = async (sql: string, values: readonly unknown[]) => {
    calls.push({ sql, values });
    // Ledger INSERT and access-pass INSERT return no rows; the final query in
    // each delivery returns the durable pass, including on Stripe retries.
    return { rows: /SELECT token, expires_at/.test(sql) ? [pass] : [] };
  };
  const payload = paidCheckoutPayload();
  const dependencies = handlerDependencies(query);

  assert.equal((await handleStripeWebhook(signedRequest(payload), dependencies)).status, 200);
  assert.equal((await handleStripeWebhook(signedRequest(payload), dependencies)).status, 200);

  assert.equal(calls.length, 6);
  assert.match(calls[0].sql, /INSERT INTO stripe_payment_ledger/);
  assert.match(calls[0].sql, /ON CONFLICT \(stripe_event_id\) DO NOTHING/);
  assert.equal(calls[0].values.includes("buyer@example.com"), false);
  assert.match(calls[1].sql, /INSERT INTO access_passes/);
  assert.match(calls[1].sql, /ON CONFLICT \(checkout_session_id\) DO NOTHING/);
  assert.equal(calls[1].values.includes("buyer@example.com"), false);
  assert.match(calls[2].sql, /SELECT token, expires_at/);
  // The duplicate delivery intentionally follows the same safe idempotent
  // statements; PostgreSQL's unique keys make it a no-op rather than a second
  // payment fact or pass.
  assert.match(calls[3].sql, /ON CONFLICT \(stripe_event_id\) DO NOTHING/);
  assert.match(calls[4].sql, /ON CONFLICT \(checkout_session_id\) DO NOTHING/);
});

test("a verified event returns 503 when ledger or pass persistence fails so Stripe retries", async () => {
  const payload = paidCheckoutPayload();
  const ledgerDown = handlerDependencies(async () => { throw new Error("database unavailable"); });
  assert.equal((await handleStripeWebhook(signedRequest(payload), ledgerDown)).status, 503);

  let call = 0;
  const passDown = handlerDependencies(async () => {
    call += 1;
    if (call === 2) throw new Error("access pass insert unavailable");
    return { rows: [] };
  });
  assert.equal((await handleStripeWebhook(signedRequest(payload), passDown)).status, 503);
});
