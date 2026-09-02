import assert from "node:assert/strict";
import test from "node:test";
import type { ServerEnv } from "@/lib/env";
import { analyzeWithGemini, extractGeminiUsageMetadata, normalizeGeminiDetections, preflightWithGemini, VisionRequestError } from "./gemini";

function detection(index: number) {
  return {
    box_2d: [index, index, index + 10, index + 10],
    brand: `Brand ${index}`,
    name: `Product ${index}`,
    confidence: 0.9,
  };
}

test("keeps up to twenty valid detections from an over-complete shelf response", () => {
  const result = normalizeGeminiDetections(Array.from({ length: 28 }, (_, index) => detection(index)));
  assert.equal(result.length, 20);
  assert.equal(result[0]?.visualCandidate.name, "Product 0");
  assert.equal(result[19]?.visualCandidate.name, "Product 19");
});

test("drops one malformed detection without discarding the rest of the shelf", () => {
  const result = normalizeGeminiDetections([
    detection(0),
    { ...detection(1), confidence: 9 },
    { name: "Missing box" },
    detection(3),
  ]);
  assert.deepEqual(result.map((item) => item.visualCandidate.name), ["Product 0", "Product 3"]);
});

const env: ServerEnv = {
  VISION_PROVIDER: "gemini",
  GEMINI_API_KEY: "test-key",
  GEMINI_VISION_MODEL: "gemini-test",
  GEMINI_PREFLIGHT_MODEL: "gemini-test",
  GEMINI_ANALYZE_MODEL: "gemini-test",
  GEMINI_PREFLIGHT_MODEL_FALLBACK: "gemini-test",
  GEMINI_ANALYZE_MODEL_FALLBACK: "gemini-test",
};
const analyzeInput = { imageBase64: "AQID", mimeType: "image/jpeg" as const, context: "shelf" as const, clientFrameId: "frame-1" };
const preflightInput = { imageBase64: "AQID", mimeType: "image/jpeg" as const, context: "shelf" as const, clientFrameId: "preflight-1" };

function providerJson(value: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 });
}

function abortWhenSignalled(init: RequestInit | undefined) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  });
}

test("extracts only valid Gemini usageMetadata counters", () => {
  assert.deepEqual(extractGeminiUsageMetadata({
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 30,
      totalTokenCount: 60,
      ignoredProviderField: "not logged",
    },
  }), {
    promptTokenCount: 10,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 30,
    totalTokenCount: 60,
  });
});

test("ignores missing or malformed Gemini usageMetadata", () => {
  assert.equal(extractGeminiUsageMetadata({}), undefined);
  assert.equal(extractGeminiUsageMetadata({ usageMetadata: { promptTokenCount: -1 } }), undefined);
  assert.equal(extractGeminiUsageMetadata({ usageMetadata: { totalTokenCount: "60" } }), undefined);
});

test("preflight propagates a client abort to Gemini", async () => {
  const originalFetch = globalThis.fetch;
  const client = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    return abortWhenSignalled(init);
  };
  try {
    const pending = preflightWithGemini(preflightInput, env, performance.now(), client.signal);
    // Model selection (an async circuit-breaker lookup) now runs before the
    // fetch is dispatched, so give that a tick to resolve before aborting --
    // otherwise the abort would preempt the request before it ever reaches
    // Gemini, which is not what this test is about.
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof VisionRequestError && error.code === "client_cancelled" && error.status === 499);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a provider AbortError without a client signal stays a timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new DOMException("provider timeout", "AbortError");
  };
  try {
    await assert.rejects(
      preflightWithGemini(preflightInput, env, performance.now()),
      (error: unknown) => error instanceof VisionRequestError && error.code === "provider_timeout" && error.status === 504,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a cancelled analyze does not retry or call Gemini when already aborted", async () => {
  const originalFetch = globalThis.fetch;
  const client = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    return abortWhenSignalled(init);
  };
  try {
    const pending = analyzeWithGemini(analyzeInput, env, performance.now(), client.signal);
    // Same reasoning as the preflight test above: let the async model
    // selection resolve so the fetch is actually in flight before aborting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof VisionRequestError && error.code === "client_cancelled");
    assert.equal(calls, 1);

    const preAborted = new AbortController();
    preAborted.abort();
    await assert.rejects(analyzeWithGemini(analyzeInput, env, performance.now(), preAborted.signal), (error: unknown) => error instanceof VisionRequestError && error.code === "client_cancelled");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a retryable provider failure still gets one analyze retry", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 503 });
    return providerJson({ detections: [] });
  };
  try {
    const result = await analyzeWithGemini(analyzeInput, env, performance.now());
    assert.equal(calls, 2);
    assert.deepEqual(result.detections, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a small expectedProductCount does not hedge when the primary answers before the delay", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return providerJson({ detections: [] });
  };
  try {
    const result = await analyzeWithGemini({ ...analyzeInput, expectedProductCount: 3 }, env, performance.now());
    assert.equal(calls, 1);
    assert.deepEqual(result.detections, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a small expectedProductCount fires a hedge after the delay and takes whichever answers first", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const primaryGate = Promise.withResolvers<void>();
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      // Primary never returns within the test; only the hedge (call 2) does.
      await primaryGate.promise;
      return providerJson({ detections: [] });
    }
    return providerJson({ detections: [detection(0)] });
  };
  try {
    const pending = analyzeWithGemini({ ...analyzeInput, expectedProductCount: 3 }, env, performance.now());
    // Let the primary's fetch() call register before advancing the clock.
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(7_000);
    const result = await pending;
    assert.equal(calls, 2);
    assert.deepEqual(result.detections.map((item) => item.visualCandidate.name), ["Product 0"]);
    primaryGate.resolve();
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = originalFetch;
  }
});

test("expectedProductCount at or above the crowded-shelf threshold never hedges", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return providerJson({ detections: [] });
  };
  try {
    await analyzeWithGemini({ ...analyzeInput, expectedProductCount: 10 }, env, performance.now());
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a client cancellation between analyze attempts prevents the retry", async () => {
  const originalFetch = globalThis.fetch;
  const client = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    client.abort();
    return new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 503 });
  };
  try {
    await assert.rejects(
      analyzeWithGemini(analyzeInput, env, performance.now(), client.signal),
      (error: unknown) => error instanceof VisionRequestError && error.code === "client_cancelled" && error.status === 499,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
