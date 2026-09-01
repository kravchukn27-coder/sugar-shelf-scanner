import assert from "node:assert/strict";
import test from "node:test";
import { anonymizeAnalyticsSubject } from "./subjects";

const ID = "a".repeat(32);

test("anonymizes a valid browser installation token with a server-only secret", () => {
  const subject = anonymizeAnalyticsSubject(ID, "analytics-subject-secret");
  assert.match(subject ?? "", /^[a-f0-9]{64}$/);
  assert.equal(subject, anonymizeAnalyticsSubject(ID, "analytics-subject-secret"));
  assert.notEqual(subject, anonymizeAnalyticsSubject(ID, "another-analytics-subject-secret"));
});

test("refuses to persist missing or malformed browser installation tokens", () => {
  assert.equal(anonymizeAnalyticsSubject(undefined, "secret"), null);
  assert.equal(anonymizeAnalyticsSubject("not-an-installation-token", "secret"), null);
  assert.equal(anonymizeAnalyticsSubject(ID, undefined), null);
  assert.equal(anonymizeAnalyticsSubject(ID, "too-short"), null);
});
