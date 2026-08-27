import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("preflight route passes Request.signal through to Gemini", async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.VISION_PROVIDER;
  const previousKey = process.env.GEMINI_API_KEY;
  const client = new AbortController();
  let providerSignal: AbortSignal | undefined;
  process.env.VISION_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    providerSignal = init?.signal ?? undefined;
    providerSignal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  });
  try {
    const request = new Request("http://localhost/api/scan/preflight", {
      method: "POST",
      signal: client.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: "AQID", mimeType: "image/jpeg", context: "shelf", clientFrameId: "route-cancel" }),
    });
    const pending = POST(request);
    await new Promise((resolve) => setImmediate(resolve));
    client.abort();
    const response = await pending;
    assert.equal(providerSignal?.aborted, true);
    assert.equal(response.status, 499);
    assert.deepEqual(await response.json(), { error: "Scan request was cancelled by the client.", code: "client_cancelled" });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousProvider === undefined) delete process.env.VISION_PROVIDER; else process.env.VISION_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
});
