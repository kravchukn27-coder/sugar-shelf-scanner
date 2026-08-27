import assert from "node:assert/strict";
import test from "node:test";
import { captureCanvasBackdropSnapshot, releaseCanvasBackdropSnapshot, type SnapshotCanvas } from "./canvas-backdrop-snapshot";

function canvas(overrides: Partial<SnapshotCanvas> = {}): SnapshotCanvas {
  return {
    width: 240,
    height: 120,
    toDataURL: () => "data:image/jpeg;base64,local-frame",
    ...overrides,
  };
}

test("captures a self-contained immutable local JPEG snapshot", () => {
  const result = captureCanvasBackdropSnapshot(canvas(), 0.8);
  assert.deepEqual(result, { dataUrl: "data:image/jpeg;base64,local-frame", width: 240, height: 120 });
  assert.ok(result);
  assert.equal(Object.isFrozen(result), true);
});

test("uses a bounded JPEG quality and rejects invalid canvas geometry", () => {
  let receivedQuality: number | undefined;
  const result = captureCanvasBackdropSnapshot(canvas({
    toDataURL: (_type, quality) => {
      receivedQuality = quality;
      return "data:image/jpeg;base64,local-frame";
    },
  }), 2);
  assert.ok(result);
  assert.equal(receivedQuality, 1);
  assert.equal(captureCanvasBackdropSnapshot(canvas({ width: 0 })), null);
  assert.equal(captureCanvasBackdropSnapshot(null), null);
});

test("fails closed when browser serialization is unavailable or rejected", () => {
  assert.equal(captureCanvasBackdropSnapshot(canvas({
    toDataURL: () => { throw new DOMException("tainted"); },
  })), null);
  assert.equal(captureCanvasBackdropSnapshot(canvas({
    toDataURL: () => "data:,",
  })), null);
});

test("release is an explicit null assignment for state and refs", () => {
  assert.equal(releaseCanvasBackdropSnapshot(), null);
});
