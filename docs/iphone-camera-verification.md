# iPhone camera verification

Run this on a physical iPhone in Safari after deployment; simulator and desktop emulation cannot validate camera lens selection or torch hardware.

1. Open the scanner, grant camera permission, and tap **Start scanning**.
2. Confirm the preview starts live and stays in the guide state until a product is captured. Record whether the initial field of view feels like the normal 1× view.
3. If the device exposes a torch capability, verify the flashlight control toggles on and off. If not, confirm it is absent.
4. If the browser exposes a zoom range below 1×, verify the wider-view control appears, changes the field of view, and returns to standard view. It is a view request, not a physical-camera guarantee; Safari may select wide or ultra-wide hardware itself.
5. Capture a product and confirm the preview freezes; only full analysis shows a spinner; Details, retry, close, and torch retain their expected behavior.
6. From a successful result and from a no-scene/error state, tap **Try again** at least three times. The restarted preview should retain the same field of view as the immediately preceding stream. If it does not, record iPhone model, iOS/Safari version, and whether the source exposed a `deviceId` in the remote inspector.

## Implementation boundary

The web API can request an `environment`-facing source and can reuse the `deviceId` reported by an existing track. It cannot request Apple’s physical “1× lens”: `facingMode` is a direction and `zoom` is a field-of-view capability, not a lens selector. The scanner therefore keeps the first request lens-neutral, applies 1× only when the selected track advertises it, and reuses an exposed source ID on retries. This follows the [Media Capture and Streams specification](https://www.w3.org/TR/mediacapture-streams/) and its documented `deviceId` source-selection behavior.

# Local camera diagnostics

For the camera-selection investigation, the client can display the current
track's safe local metadata using `getCameraDiagnosticSnapshot()` from
`src/lib/scan/camera-diagnostics.ts`. It intentionally excludes camera labels,
raw `deviceId` values, frames, images and OCR. Do not log it or send it to an
API; record only the visible values during the manual iPhone protocol.
