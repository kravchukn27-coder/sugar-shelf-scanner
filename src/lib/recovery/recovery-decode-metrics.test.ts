import assert from "node:assert/strict";
import test from "node:test";
import { reportLocalBarcodeDecode } from "./recovery-decode-metrics";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");

function restoreBrowserGlobals() {
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else delete (globalThis as { navigator?: Navigator }).navigator;
  if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
  else delete (globalThis as { fetch?: typeof fetch }).fetch;
}

test("does nothing when recovery metrics are disabled", () => {
  let calls = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: () => { calls += 1; return true; } } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: () => { calls += 1; return Promise.resolve(); } });
  try {
    reportLocalBarcodeDecode(false, "decoded");
    assert.equal(calls, 0);
  } finally {
    restoreBrowserGlobals();
  }
});

test("sends the allowlisted aggregate outcome using sendBeacon", async () => {
  let request: { url: string; body: Blob } | undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: (url: string, body: Blob) => { request = { url, body }; return true; } } });
  try {
    reportLocalBarcodeDecode(true, "not_recognised");
    assert.equal(request?.url, "/api/scan/recovery-metrics");
    assert.deepEqual(JSON.parse(await request!.body.text()), { localBarcodeDecode: "not_recognised" });
  } finally {
    restoreBrowserGlobals();
  }
});

test("falls back to a keepalive fetch when sendBeacon is unavailable or declines", () => {
  let request: RequestInit | undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: () => false } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (_url: string, init: RequestInit) => { request = init; return Promise.resolve(new Response()); } });
  try {
    reportLocalBarcodeDecode(true, "reader_unavailable");
    assert.deepEqual(request, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ localBarcodeDecode: "reader_unavailable" }),
      keepalive: true,
    });
  } finally {
    restoreBrowserGlobals();
  }
});

test("suppresses telemetry transport failures", () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get sendBeacon() { throw new Error("blocked"); } } });
  try {
    assert.doesNotThrow(() => reportLocalBarcodeDecode(true, "decoded"));
  } finally {
    restoreBrowserGlobals();
  }
});
