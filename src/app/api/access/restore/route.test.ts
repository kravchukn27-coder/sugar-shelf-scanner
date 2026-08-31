import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

const ACCESS_KEYS = ["STRIPE_SECRET_KEY", "ACCESS_PASS_SECRET", "DATABASE_URL"] as const;

function request(body: unknown) {
  return new Request("http://localhost/api/access/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("restore answers 503 while paid access is not configured", async () => {
  const previous = ACCESS_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ACCESS_KEYS) delete process.env[key];
  try {
    const response = await POST(request({ email: "buyer@example.com" }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("restore rejects a body that is not an email address", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.ACCESS_PASS_SECRET = "0123456789abcdef01";
  process.env.DATABASE_URL = "postgres://localhost:5432/sugar";
  try {
    assert.equal((await POST(request({ email: "not-an-address" }))).status, 400);
    assert.equal((await POST(request({}))).status, 400);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ACCESS_PASS_SECRET;
    delete process.env.DATABASE_URL;
  }
});
