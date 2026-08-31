import assert from "node:assert/strict";
import test from "node:test";
import { describeCameraAccessFailure } from "./camera-access";

test("a blocked permission sends the user to settings but keeps a way back", () => {
  const denied = describeCameraAccessFailure(new DOMException("Permission denied", "NotAllowedError"));
  // The browser will not prompt again, so the copy has to name the setting.
  // The retry stays, because that is how the user returns after allowing it.
  assert.match(denied.message, /browser settings/);
  assert.equal(denied.canRetry, true);
  assert.equal(describeCameraAccessFailure(new DOMException("", "SecurityError")).message, denied.message);
});

test("a missing camera points at the gallery instead of a retry", () => {
  const missing = describeCameraAccessFailure(new DOMException("", "NotFoundError"));
  assert.equal(missing.canRetry, false);
  assert.match(missing.message, /gallery/);
  assert.equal(describeCameraAccessFailure(new DOMException("", "OverconstrainedError")).message, missing.message);
});

test("a camera held by something else is worth retrying", () => {
  const busy = describeCameraAccessFailure(new DOMException("", "NotReadableError"));
  assert.equal(busy.canRetry, true);
  assert.match(busy.message, /in use/i);
});

test("every message keeps the heading and description on separate lines", () => {
  for (const error of ["NotAllowedError", "NotFoundError", "NotReadableError"]) {
    const [heading, ...rest] = describeCameraAccessFailure(new DOMException("", error)).message.split("\n");
    assert.ok(heading.length > 0, `${error} has a heading`);
    assert.ok(rest.join(" ").length > 0, `${error} has a description`);
  }
});

test("an unrecognised or malformed rejection keeps the generic retryable copy", () => {
  const generic = describeCameraAccessFailure(new DOMException("", "WeirdNewError"));
  assert.equal(generic.canRetry, true);
  assert.match(generic.message, /Camera unavailable/);
  for (const value of [null, undefined, "boom", 42, {}, { name: 7 }]) {
    assert.equal(describeCameraAccessFailure(value).message, generic.message);
  }
});
