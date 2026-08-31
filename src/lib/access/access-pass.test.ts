import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_WINDOW_DAYS, createAccessToken, digestEmail, findActivePassByEmail, issueAccessPass } from "./access-pass";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const SECRET = "0123456789abcdef01";

type Call = { sql: string; parameters: readonly unknown[] };

function fakeDatabase(responses: Array<Array<Record<string, unknown>>>) {
  const calls: Call[] = [];
  const executor = {
    async query<Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) {
      calls.push({ sql, parameters });
      return { rows: (responses.shift() ?? []) as Row[] };
    },
  };
  return { executor, calls };
}

test("an access token is 48 lowercase hex characters and unpredictable", () => {
  const first = createAccessToken();
  assert.match(first, /^[0-9a-f]{48}$/);
  assert.notEqual(first, createAccessToken());
});

test("email digests are stable, keyed, and case/whitespace insensitive", () => {
  const digest = digestEmail("Buyer@Example.com", SECRET);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, digestEmail("  buyer@example.com  ", SECRET));
  assert.notEqual(digest, digestEmail("buyer@example.com", "a-different-secret1"));
});

test("issuing a pass inserts idempotently and returns the stored row", async () => {
  const expiresAt = "2026-09-08T12:00:00.000Z";
  const { executor, calls } = fakeDatabase([[], [{ token: "b".repeat(48), expires_at: expiresAt }]]);
  const pass = await issueAccessPass(executor, {
    checkoutSessionId: "cs_test_123",
    email: "buyer@example.com",
    secret: SECRET,
    now: NOW,
  });
  assert.deepEqual(pass, { token: "b".repeat(48), expiresAt });
  assert.match(calls[0].sql, /ON CONFLICT \(checkout_session_id\) DO NOTHING/);
  // The readable address must never be a query parameter.
  assert.equal(calls[0].parameters.includes("buyer@example.com"), false);
  assert.equal(calls[0].parameters[2], digestEmail("buyer@example.com", SECRET));
  assert.equal(calls[0].parameters[4], new Date(NOW.getTime() + ACCESS_WINDOW_DAYS * 86_400_000).toISOString());
});

test("issuing a pass fails loudly when the row cannot be read back", async () => {
  const { executor } = fakeDatabase([[], []]);
  await assert.rejects(
    () => issueAccessPass(executor, { checkoutSessionId: "cs_test_123", email: "buyer@example.com", secret: SECRET, now: NOW }),
    /did not produce a row/,
  );
});

test("restore finds only an unexpired pass for that address", async () => {
  const { executor, calls } = fakeDatabase([[{ token: "c".repeat(48), expires_at: new Date("2026-09-05T00:00:00.000Z") }]]);
  const pass = await findActivePassByEmail(executor, { email: "buyer@example.com", secret: SECRET, now: NOW });
  assert.deepEqual(pass, { token: "c".repeat(48), expiresAt: "2026-09-05T00:00:00.000Z" });
  assert.match(calls[0].sql, /expires_at > \$2/);
  assert.equal(calls[0].parameters[1], NOW.toISOString());

  const empty = fakeDatabase([[]]);
  assert.equal(await findActivePassByEmail(empty.executor, { email: "nobody@example.com", secret: SECRET, now: NOW }), null);
});
