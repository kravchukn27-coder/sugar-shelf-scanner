import assert from "node:assert/strict";
import test from "node:test";
import { resetOperationalIncidentCooldownsForTests, sendOperationalIncident } from "./telegram-alert";

const enabled = {
  NODE_ENV: "test",
  TELEGRAM_ALERTS_ENABLED: "true",
  TELEGRAM_ALERT_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz_123456",
  TELEGRAM_ALERT_CHAT_ID: "-1001234567890",
} as NodeJS.ProcessEnv;

test("Telegram incidents are disabled until both server-only credentials are configured", async () => {
  let calls = 0;
  await sendOperationalIncident({ kind: "health_unavailable", route: "/api/health", status: 503 }, { NODE_ENV: "test" } as NodeJS.ProcessEnv, async () => { calls += 1; return new Response(); });
  assert.equal(calls, 0);
});

test("Telegram incidents send only the allowlisted operational summary and are deduplicated", async () => {
  resetOperationalIncidentCooldownsForTests();
  const requests: RequestInit[] = [];
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init!);
    return new Response("ok");
  };
  const incident = { kind: "scan_failure" as const, route: "analyze", status: 503, code: "rate_limiter_unavailable" };
  await sendOperationalIncident(incident, enabled, fetch);
  await sendOperationalIncident(incident, enabled, fetch);
  assert.equal(requests.length, 1);
  const payload = JSON.parse(String(requests[0].body));
  assert.equal(payload.chat_id, "-1001234567890");
  assert.match(payload.text, /scan_failure/);
  assert.match(payload.text, /rate_limiter_unavailable/);
  assert.equal(payload.text.includes("token"), false);
});
