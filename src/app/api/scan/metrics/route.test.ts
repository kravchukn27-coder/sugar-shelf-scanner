import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

const metric = {
  completion: "preflight_terminal",
  captureReadyMs: 100,
  preflightRttMs: 250,
  preflightAttempts: 1,
  qualitySkipped: 0,
};

async function withMetricsFlag(value: string | undefined, run: () => Promise<void>) {
  const previous = process.env.SCANNER_METRICS_ENABLED;
  if (value === undefined) delete process.env.SCANNER_METRICS_ENABLED;
  else process.env.SCANNER_METRICS_ENABLED = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.SCANNER_METRICS_ENABLED;
    else process.env.SCANNER_METRICS_ENABLED = previous;
  }
}

function request(body: unknown) {
  return new Request("http://localhost/api/scan/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("metrics route is a silent no-op while disabled", async () => {
  await withMetricsFlag(undefined, async () => {
    const previousInfo = console.info;
    const entries: unknown[] = [];
    console.info = (entry: unknown) => entries.push(entry);
    try {
      const response = await POST(request({ ...metric, forbidden: "not logged" }));
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(entries, []);
    } finally {
      console.info = previousInfo;
    }
  });
});

test("metrics route strictly rejects an unknown field without logging", async () => {
  await withMetricsFlag("true", async () => {
    const previousInfo = console.info;
    const entries: unknown[] = [];
    console.info = (entry: unknown) => entries.push(entry);
    try {
      const response = await POST(request({ ...metric, scanId: "forbidden" }));
      assert.equal(response.status, 400);
      assert.deepEqual(entries, []);
    } finally {
      console.info = previousInfo;
    }
  });
});

test("metrics route logs one allowlisted aggregate event when enabled", async () => {
  await withMetricsFlag("true", async () => {
    const previousInfo = console.info;
    const entries: string[] = [];
    console.info = (entry: string) => entries.push(entry);
    try {
      const response = await POST(request(metric));
      assert.equal(response.status, 204);
    } finally {
      console.info = previousInfo;
    }
    assert.deepEqual(JSON.parse(entries[0]), { event: "scanner_completed", ...metric });
  });
});
