import assert from "node:assert/strict";
import test from "node:test";
import { verifyCheckoutSession } from "./stripe-checkout";

const KEY = "sk_test_example";

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("a malformed session id never reaches Stripe", async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse({}));
  assert.deepEqual(await verifyCheckoutSession("../../admin", KEY, impl), { status: "invalid" });
  assert.deepEqual(await verifyCheckoutSession("", KEY, impl), { status: "invalid" });
  assert.deepEqual(calls, []);
});

test("a paid session returns the buyer address", async () => {
  const { impl, calls } = fakeFetch((url, init) => {
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions/cs_test_abc123");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${KEY}`);
    return jsonResponse({ payment_status: "paid", customer_details: { email: "buyer@example.com" } });
  });
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, impl), {
    status: "paid",
    email: "buyer@example.com",
  });
  assert.equal(calls.length, 1);
});

test("an unpaid session is reported as unpaid", async () => {
  const { impl } = fakeFetch(() => jsonResponse({ payment_status: "unpaid", customer_details: { email: "buyer@example.com" } }));
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, impl), { status: "unpaid" });
});

test("an unknown session is invalid, and Stripe being down is not the buyer's fault", async () => {
  const missing = fakeFetch(() => new Response("", { status: 404 }));
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, missing.impl), { status: "invalid" });

  const broken = fakeFetch(() => new Response("", { status: 500 }));
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, broken.impl), { status: "unavailable" });

  const offline = fakeFetch(() => { throw new Error("network down"); });
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, offline.impl), { status: "unavailable" });

  // Paid but with no address to key a pass on: we cannot complete the flow,
  // and refusing the payment would be wrong, so this reads as a service fault.
  const noEmail = fakeFetch(() => jsonResponse({ payment_status: "paid", customer_details: {} }));
  assert.deepEqual(await verifyCheckoutSession("cs_test_abc123", KEY, noEmail.impl), { status: "unavailable" });
});
