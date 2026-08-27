import assert from "node:assert/strict";
import test from "node:test";
import { logVisionUsageTelemetry } from "./vision";

test("vision usage logger emits only provider aggregate counters", () => {
  const previousInfo = console.info;
  const entries: string[] = [];
  console.info = (entry: string) => entries.push(entry);
  try {
    logVisionUsageTelemetry({
      operation: "preflight",
      model: "gemini-test",
      durationMs: 123,
      status: 200,
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 30,
      totalTokenCount: 60,
    });
  } finally {
    console.info = previousInfo;
  }
  assert.deepEqual(JSON.parse(entries[0]!), {
    event: "vision_usage",
    operation: "preflight",
    model: "gemini-test",
    durationMs: 123,
    status: 200,
    promptTokenCount: 10,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 30,
    totalTokenCount: 60,
  });
});
