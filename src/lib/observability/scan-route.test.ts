import assert from "node:assert/strict";
import test from "node:test";
import { scanJsonResponse } from "./scan-route";

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
