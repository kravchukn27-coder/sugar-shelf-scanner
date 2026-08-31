import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

const ACCESS_KEYS = ["STRIPE_SECRET_KEY", "ACCESS_PASS_SECRET", "DATABASE_URL"] as const;

async function withoutAccessConfig(run: () => Promise<void>) {
  const previous = ACCESS_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ACCESS_KEYS) delete process.env[key];
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(body: unknown) {
  return new Request("http://localhost/api/access/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("redeem answers 503 while paid access is not configured", async () => {
  await withoutAccessConfig(async () => {
    const response = await POST(request({ checkoutSessionId: "cs_test_abc123" }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
});

test("redeem rejects a body that is not a checkout session id", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.ACCESS_PASS_SECRET = "0123456789abcdef01";
  process.env.DATABASE_URL = "postgres://localhost:5432/sugar";
  try {
    // A malformed id is refused before any Stripe call is attempted.
    assert.equal((await POST(request({ checkoutSessionId: "../admin" }))).status, 400);
    assert.equal((await POST(request({ token: "nope" }))).status, 400);
    assert.equal((await POST(request(null))).status, 400);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ACCESS_PASS_SECRET;
    delete process.env.DATABASE_URL;
  }
});
