# Browser camera policy

## Accepted current behaviour

The tested iPhone produced a `1920×1440`, 30 fps environment stream after the
best-effort quality preference, compared with an earlier `480×640` observation.
Recognition improved. Keep the existing default `1×` pipeline unchanged unless
a reproducible regression appears.

The browser requests an environment-facing camera, then applies quality and
zoom preferences only to the selected track. Web APIs cannot guarantee Apple’s
physical “1×” lens: `facingMode`, `deviceId` and digital `zoom` are not a
physical-lens selector. Retry reuses an exposed source ID when possible; it
falls back safely otherwise.

- Optional `2×` is digital track zoom only and remains a temporary control.
- The modest 1.12× centred crop is applied only after positive preflight to the
  frozen analysis frame. It is not the main cause of the live field of view.
- Live preview closeness is primarily the selected stream plus portrait
  `object-fit: cover` presentation.
- Do not resume `ImageCapture.takePhoto()` or physical-lens experiments unless
  the regression protocol proves a need.

## Privacy-safe local diagnostics

Open the scanner with `?cameraDebug=1`. The overlay shows only opaque
`camera-N`, effective width/height/fps/facing/zoom, capability range/torch and
`ImageCapture` availability. It must stay local: do not log or send camera
labels, raw device IDs, frames, images or OCR.

## Regression checklist

1. In Safari (or Add to Home Screen), record iPhone model, iOS and Safari
   version, then open `?cameraDebug=1` and Start.
2. Confirm the preview is live at the normal perceived default view; record
   visible diagnostic settings only.
3. If present, test torch. If the track advertises 2×, toggle it once and back:
   it must be described as digital zoom, not a lens change.
4. Capture a product: preview freezes, spinner appears only for full analysis,
   Details/retry/close work.
5. Run Try again three times. Effective settings and perceived FOV should stay
   stable; record a screen recording and diagnostics if they change.
6. Test Gallery with the same original photo: spinner immediately, copy only
   after candidate, then aligned results or a clear error.

The longer operational checklist remains in
[iphone-camera-verification.md](iphone-camera-verification.md).
