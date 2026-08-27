# iPhone camera verification

The current browser-camera stage is accepted on the tested iPhone: the quality
preference produced an effective `1920×1440`, 30 fps environment stream and
improved recognition speed. Keep the current default `1×` pipeline unchanged
unless a reproducible regression appears. Simulator and desktop emulation still
cannot validate camera lens selection or torch hardware.

Use this as a regression checklist after a camera-related deploy.

1. Open the scanner, grant camera permission, and tap **Start scanning**.
2. Confirm the preview starts live and stays in the guide state until a product is captured. Record whether the initial field of view feels like the normal 1× view.
3. If the device exposes a torch capability, verify the flashlight control toggles on and off. If not, confirm it is absent.
4. Confirm that the scanner does not show a zoom or magnifier control. Browser-reported zoom capability may appear in local diagnostics, but it is not a physical-camera guarantee and is not a user control.
5. Capture a product and confirm the preview freezes; only full analysis shows a spinner; Details, retry, close, and torch retain their expected behavior.
6. From a successful result and from a no-scene/error state, tap **Try again** at least three times. The restarted preview should retain the same field of view as the immediately preceding stream. If it does not, record iPhone model, iOS/Safari version, and whether the source exposed a `deviceId` in the remote inspector.

## Implementation boundary

The web API can request an `environment`-facing source and can reuse the `deviceId` reported by an existing track. It cannot request Apple’s physical “1× lens”: `facingMode` is a direction and `zoom` is a field-of-view capability, not a lens selector. The scanner therefore keeps the first request lens-neutral, applies a best-effort higher portrait quality preference to the selected track, applies `1×` only when the track advertises it, and reuses an exposed source ID on retries. It does not expose zoom as a user-facing control. This follows the [Media Capture and Streams specification](https://www.w3.org/TR/mediacapture-streams/) and its documented `deviceId` source-selection behavior.

On the tested iPhone Safari session, a `1920×1440` landscape camera track is
expected even when the app requests portrait constraints. A tall full-screen
`object-fit: cover` preview will therefore look closer than the native Camera
app. Treat that as the documented platform limitation, not a regression,
unless the effective stream settings or visible FOV change from the recorded
baseline in [camera.md](camera.md#closed-investigation-iphone-safari-portrait-viewfinder-2026-08-27).

# Local camera diagnostics

For the camera-selection investigation, the client can display the current
track's safe local metadata using `getCameraDiagnosticSnapshot()` from
`src/lib/scan/camera-diagnostics.ts`. It intentionally excludes camera labels,
raw `deviceId` values, frames, images and OCR. Do not log it or send it to an
API; record only the visible values during the manual iPhone protocol.
