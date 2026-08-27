import assert from "node:assert/strict";
import test from "node:test";
import { reportResultMetric } from "./result-metrics";

const metric = { action: "scan_started" } as const;

test("does nothing while result metrics are disabled", () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls += 1; return Promise.resolve(new Response()); }) as typeof fetch;
  try {
    reportResultMetric(false, metric);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("uses beacon when available", () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  let url = "";
  let fetchCalls = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: (nextUrl: string) => { url = nextUrl; return true; } } });
  globalThis.fetch = (() => { fetchCalls += 1; return Promise.resolve(new Response()); }) as typeof fetch;
  try {
    reportResultMetric(true, metric);
    assert.equal(url, "/api/scan/result-metrics");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});

test("falls back to keepalive fetch and suppresses telemetry errors", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  let init: RequestInit | undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: () => false } });
  globalThis.fetch = ((_url: string, nextInit?: RequestInit) => { init = nextInit; return Promise.reject(new Error("offline")); }) as typeof fetch;
  try {
    assert.doesNotThrow(() => reportResultMetric(true, metric));
    await Promise.resolve();
    assert.equal(init?.method, "POST");
    assert.equal(init?.keepalive, true);
    assert.deepEqual(JSON.parse(String(init?.body)), metric);
  } finally {
    globalThis.fetch = previousFetch;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});
