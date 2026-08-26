import assert from "node:assert/strict";
import test from "node:test";
import { applyCameraView, getCameraControls, rearCameraRequest, supportsTorch } from "./media-capabilities";

function track(capabilities: { torch?: boolean; zoom?: { min?: number; max?: number } }, applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>) {
  return { getCapabilities: () => capabilities, applyConstraints } as unknown as MediaStreamTrack;
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

test("requests the rear camera before optional track controls are applied", () => {
  assert.deepEqual(rearCameraRequest(), { video: { facingMode: { ideal: "environment" }, zoom: { ideal: 1 }, width: { ideal: 1280 }, height: { ideal: 1920 } }, audio: false });
});
