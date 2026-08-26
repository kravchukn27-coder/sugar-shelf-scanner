import assert from "node:assert/strict";
import test from "node:test";
import { getCameraDiagnosticSnapshot, getImageCaptureSupport } from "./camera-diagnostics";

function track(settings: object, capabilities: object): MediaStreamTrack {
  return { getSettings: () => settings, getCapabilities: () => capabilities } as MediaStreamTrack;
}

test("camera diagnostics expose only safe track metadata and a local opaque source id", () => {
  const first = getCameraDiagnosticSnapshot(track(
    { deviceId: "browser-private-camera-id", width: 1920, height: 1080, frameRate: 30, aspectRatio: 16 / 9, facingMode: "environment", zoom: 1 },
    { torch: true, zoom: { min: 0.5, max: 3 } },
  ));
  const second = getCameraDiagnosticSnapshot(track({ deviceId: "browser-private-camera-id" }, {}));

  assert.deepEqual(first.settings, { width: 1920, height: 1080, frameRate: 30, aspectRatio: 16 / 9, facingMode: "environment", zoom: 1 });
  assert.deepEqual(first.capabilities, { torch: true, zoom: { min: 0.5, max: 3 } });
  assert.equal(first.source.deviceIdExposed, true);
  assert.match(first.source.sessionId ?? "", /^camera-\d+$/);
  assert.equal(first.source.sessionId, second.source.sessionId);
  assert.equal(JSON.stringify(first).includes("browser-private-camera-id"), false);
});

test("camera diagnostics omit unsupported and malformed metadata", () => {
  const snapshot = getCameraDiagnosticSnapshot(track(
    { deviceId: "  ", width: Number.NaN, frameRate: Infinity, facingMode: 42 },
    { torch: false, zoom: { min: Number.NaN, max: Infinity } },
  ));

  assert.deepEqual(snapshot.source, { deviceIdExposed: false, sessionId: null });
  assert.deepEqual(snapshot.settings, { width: null, height: null, frameRate: null, aspectRatio: null, facingMode: null, zoom: null });
  assert.deepEqual(snapshot.capabilities, { torch: false, zoom: null });
});

test("ImageCapture support checks the constructor and takePhoto method without capturing", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "ImageCapture");
  try {
    Object.defineProperty(globalThis, "ImageCapture", { configurable: true, value: function ImageCapture() {} });
    assert.deepEqual(getImageCaptureSupport(), { supported: true, takePhoto: false });

    Object.defineProperty(globalThis, "ImageCapture", { configurable: true, value: function ImageCapture() {} });
    const imageCapture = (globalThis as typeof globalThis & { ImageCapture?: { prototype: { takePhoto: () => never } } }).ImageCapture;
    imageCapture!.prototype.takePhoto = () => { throw new Error("must not be called"); };
    assert.deepEqual(getImageCaptureSupport(), { supported: true, takePhoto: true });
  } finally {
    if (original) Object.defineProperty(globalThis, "ImageCapture", original);
    else Reflect.deleteProperty(globalThis, "ImageCapture");
  }
});
