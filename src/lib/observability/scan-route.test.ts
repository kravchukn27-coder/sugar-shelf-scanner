import assert from "node:assert/strict";
import test from "node:test";
import { logAccessRequest, scanJsonResponse } from "./scan-route";

function withMetricsFlag(value: string | undefined, run: () => void) {
  const previous = process.env.SCANNER_METRICS_ENABLED;
  if (value === undefined) delete process.env.SCANNER_METRICS_ENABLED;
  else process.env.SCANNER_METRICS_ENABLED = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.SCANNER_METRICS_ENABLED;
    else process.env.SCANNER_METRICS_ENABLED = previous;
  }
}

test("scan responses advertise metrics only when explicitly enabled", () => {
  withMetricsFlag(undefined, () => {
    const response = scanJsonResponse({}, { status: 200 }, { route: "preflight", startedAt: performance.now(), status: 200 });
    assert.equal(response.headers.get("X-Scanner-Metrics"), null);
  });
  withMetricsFlag("true", () => {
    const response = scanJsonResponse({}, { status: 200 }, { route: "analyze", startedAt: performance.now(), status: 200 });
    assert.equal(response.headers.get("X-Scanner-Metrics"), "enabled");
  });
  withMetricsFlag("true", () => {
    const response = scanJsonResponse({}, { status: 200 }, { route: "recovery_label", startedAt: performance.now(), status: 200 });
    assert.equal(response.headers.get("X-Scanner-Metrics"), null);
  });
});

test("analyze response preserves parallel timing stages in Server-Timing", () => {
  const response = scanJsonResponse({}, { status: 200 }, {
    route: "analyze",
    startedAt: performance.now() - 20,
    status: 200,
    visionMs: 15,
    catalogMs: 10,
    dbProbeMs: 12,
    catalogResolutionMs: 10,
  });
  const serverTiming = response.headers.get("Server-Timing") ?? "";
  assert.match(serverTiming, /db_probe;dur=12/);
  assert.match(serverTiming, /catalog_resolution;dur=10/);
});

test("logAccessRequest logs route, status, and duration with no other fields", () => {
  const originalInfo = console.info;
  const logs: unknown[] = [];
  console.info = (...args: unknown[]) => { logs.push(args[0]); };
  try {
    logAccessRequest("access_restore", performance.now() - 5, 404);
  } finally {
    console.info = originalInfo;
  }
  assert.equal(logs.length, 1);
  const payload = JSON.parse(logs[0] as string);
  assert.equal(payload.event, "access_request");
  assert.equal(payload.route, "access_restore");
  assert.equal(payload.status, 404);
  assert.equal(typeof payload.durationMs, "number");
  assert.deepEqual(Object.keys(payload).sort(), ["durationMs", "event", "route", "status"]);
});
