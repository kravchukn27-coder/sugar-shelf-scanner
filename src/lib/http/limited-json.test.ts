import assert from "node:assert/strict";
import test from "node:test";
import { readLimitedJson } from "./limited-json";

test("declared oversized JSON is rejected before its stream is read", async () => {
  const body = new ReadableStream<Uint8Array>({});
  const request = new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-length": "101" },
    body,
    duplex: "half",
  } as RequestInit);
  assert.deepEqual(await readLimitedJson(request, 100), { kind: "too_large" });
  assert.equal(request.bodyUsed, false);
});
