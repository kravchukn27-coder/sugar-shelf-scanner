import assert from "node:assert/strict";
import test from "node:test";
import { applyCameraView, getCameraControls, getCameraDeviceId, rearCameraRequest, supportsTorch } from "./media-capabilities";

function track(
  capabilities: { torch?: boolean; zoom?: { min?: number; max?: number } },
  applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>,
  deviceId?: string,
) {
  return { getCapabilities: () => capabilities, applyConstraints, getSettings: () => ({ deviceId }) } as unknown as MediaStreamTrack;
}

test("reports a wider view only when 1× and a lower zoom are available", () => {
  assert.deepEqual(getCameraControls(track({ torch: true, zoom: { min: 0.5, max: 3 } })), { torchAvailable: true, standardZoom: 1, wideZoom: 0.5 });
  assert.deepEqual(getCameraControls(track({ zoom: { min: 1, max: 3 } })), { torchAvailable: false, standardZoom: 1, wideZoom: null });
  assert.deepEqual(getCameraControls(track({ zoom: { min: 1.2, max: 3 } })), { torchAvailable: false, standardZoom: null, wideZoom: null });
  assert.equal(supportsTorch(track({ torch: true })), true);
});

test("applies only advertised standard or wide zoom values", async () => {
  const applied: MediaTrackConstraints[] = [];
  const capable = track({ zoom: { min: 0.5, max: 3 } }, async (constraints) => { applied.push(constraints); });
  const controls = getCameraControls(capable);
  assert.equal(await applyCameraView(capable, controls, "standard"), true);
  assert.equal(await applyCameraView(capable, controls, "wide"), true);
  assert.deepEqual(applied, [{ advanced: [{ zoom: 1 }] }, { advanced: [{ zoom: 0.5 }] }]);
  assert.equal(await applyCameraView(track({}), getCameraControls(track({})), "wide"), false);
});

test("remembers an exposed source identifier so retries can request the same camera", () => {
  assert.equal(getCameraDeviceId(track({}, undefined, "rear-camera-id")), "rear-camera-id");
  assert.equal(getCameraDeviceId(track({}, undefined, "   ")), null);
  assert.equal(getCameraDeviceId(undefined), null);
});

test("keeps the first rear request lens-neutral and pins a known source on retry", () => {
  assert.deepEqual(rearCameraRequest(), { video: { facingMode: { ideal: "environment" } }, audio: false });
  assert.deepEqual(rearCameraRequest("rear-camera-id"), { video: { deviceId: { exact: "rear-camera-id" } }, audio: false });
  assert.deepEqual(rearCameraRequest("   "), { video: { facingMode: { ideal: "environment" } }, audio: false });
});
