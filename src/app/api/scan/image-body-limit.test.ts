import assert from "node:assert/strict";
import test from "node:test";
import { POST as analyze } from "./analyze/route";
import { POST as preflight } from "./preflight/route";
import { POST as recoveryLabel } from "./recovery-label/route";
import { IMAGE_JSON_BODY_LIMITS } from "@/lib/http/limited-json";

function chunkedRequest(path: string, bytes: number) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  // A stream body deliberately has no Content-Length, exercising the
  // authoritative streaming cap rather than only its fast header check.
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
}

test("all image POST routes return 413 for an unbounded chunked body before Gemini", async () => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  globalThis.fetch = async () => { geminiCalls += 1; throw new Error("Gemini must not be called"); };
  try {
    const responses = await Promise.all([
      analyze(chunkedRequest("/api/scan/analyze", IMAGE_JSON_BODY_LIMITS.analyze + 1)),
      preflight(chunkedRequest("/api/scan/preflight", IMAGE_JSON_BODY_LIMITS.preflight + 1)),
      recoveryLabel(chunkedRequest("/api/scan/recovery-label", IMAGE_JSON_BODY_LIMITS.recoveryLabel + 1)),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: "Request body is too large.", code: "body_too_large" });
    }
    assert.equal(geminiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
