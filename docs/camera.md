# Browser camera policy

## Accepted current behaviour

The tested iPhone produced a `1920×1440`, 30 fps environment stream after the
best-effort quality preference, compared with an earlier `480×640` observation.
Recognition improved. Keep the existing default `1×` pipeline unchanged unless
a reproducible regression appears.

The browser requests an environment-facing camera, then applies a best-effort
quality preference to the selected track. When a selected track advertises a
standard `1×` zoom value, the scanner applies it as a neutral baseline. Web
APIs cannot guarantee Apple’s physical “1×” lens: `facingMode`, `deviceId` and
digital `zoom` are not a physical-lens selector. Retry reuses an exposed source
ID when possible; it falls back safely otherwise.

- The scanner does not expose a user-facing zoom or magnifier control. It may
  inspect track zoom capabilities for compatibility and diagnostics; any such
  value is a digital field-of-view capability, not a lens selection.
- The modest 1.12× centred crop is applied only after positive preflight to the
  frozen analysis frame. It is not the main cause of the live field of view.
- Live preview closeness is primarily the selected stream plus portrait
  `object-fit: cover` presentation.
- Do not resume `ImageCapture.takePhoto()` or physical-lens experiments unless
  the regression protocol proves a need.

## Closed investigation: iPhone Safari portrait viewfinder (2026-08-27)

### Decision

Keep the production scanner unchanged. The isolated `/camera-crop-test` route
remains available as a local, on-device diagnostic; it is not linked from the
product and does not change `src/app/page.tsx`.

On the tested iPhone Safari session, web constraints cannot produce a
native-Camera-style portrait stream or wider live field of view. Do not repeat
the CSS rotation, `exact` portrait, or `resizeMode` experiments unless a new
iOS/WebKit version changes the observed capabilities.

### Recorded evidence

The diagnostics used a `402×714` viewport and reported an `environment`
`1920×1440` (4:3 landscape) stream at zoom `1` with a `0.5–10` advertised
zoom range. The perceived closeness is therefore not a default 2× zoom or a
physical-lens selection bug.

| Presentation | Visible source-frame width | Result |
| --- | ---: | --- |
| Production full-screen portrait box + `object-fit: cover` | ~42% | No empty space, but substantial horizontal crop. |
| Test `402×536` (3:4) box + `cover` | ~56% | About one-third more horizontal FOV than production, with unavoidable top/bottom idle space. |
| Test 4:3 frame + `contain` | 100% | Unacceptably large black bars. |

For this browser stream, this is a trade-off rather than an unimplemented CSS
setting: making the box taller reduces black space but crops more horizontal
FOV; making it shorter shows more FOV but increases black space. Filling the
current 3:4 box already uses all pixels available to that presentation.

### Constraint results

The isolated route records support, the requested constraints, and effective
track settings locally. On the tested device:

- `width`, `height`, `aspectRatio`, and `facingMode` reported as supported;
  `resizeMode` reported unsupported.
- A request with `aspectRatio: { exact: 3 / 4 }`, `width: { exact: 1440 }`,
  and `height: { exact: 1920 }` resolved but the resulting stream remained
  `1920×1440`. Safari did not reject it with `OverconstrainedError`.
- The equivalent `crop-and-scale` request is not a valid test on this device:
  `resizeMode` is unsupported and may be ignored by the browser.
- Rotating the `<video>` element by either 90° direction rotated only the
  already-delivered pixels. It changed neither the field of view nor the
  stream format, so it is not a solution.

The Media Capture and Streams model says supported required (`exact`)
constraints should be satisfied or reject. The observed Safari behavior is a
browser limitation/implementation issue, not a scanner request that can be
made more forceful. See the [Media Capture and Streams
specification](https://www.w3.org/TR/mediacapture-streams/).

### What would change this decision

Reopen the investigation only if one of these inputs changes:

1. A target iOS/Safari release reports and honors `resizeMode`, or honors an
   exact portrait track request.
2. The product scope permits native iOS capture (AVFoundation), which has
   direct control over output orientation and camera format.
3. Product design explicitly accepts the 3:4 box's idle space in exchange for
   its ~33% wider live field of view.

## Camera access failures

Permission belongs to the browser and the OS, not to the app. Nothing here can
grant, persist or suppress the prompt, so the only thing under our control is
what the user is told when the request fails.

`getUserMedia` rejections are mapped by the error's `name`:

| Rejection | What the user sees | Retry offered |
| --- | --- | --- |
| `NotAllowedError`, `PermissionDeniedError`, `SecurityError` | "Camera access is off" plus the instruction to allow the camera for this site in browser settings | yes |
| `NotFoundError`, `DevicesNotFoundError`, `OverconstrainedError` | "No camera available", pointing at the gallery | no |
| `NotReadableError`, `TrackStartError`, `AbortError` | "Camera is in use", asking to close whatever holds it | yes |
| anything else | the previous generic copy | yes |

A blocked permission keeps its retry button even though the browser will not
prompt again: the user allows the camera in settings and comes back through it.
A device with no camera loses the button, because nothing the user does on that
screen changes the answer.

The Permissions API is deliberately unused. Safari exposes no `camera` entry,
so `navigator.permissions.query` would be blind on the one platform this
matters most on, while the rejection's `name` is available everywhere.

Persisting the grant is a packaging decision, not a code one. In a Safari tab
the permission is re-requested on later visits unless the user sets it per-site;
installed to the Home Screen the origin becomes a standalone app and iOS keeps
the grant in system settings. `manifest.webmanifest` already declares
`display: standalone`, but the install is not yet finished: there are no icons
and no apple-specific meta tags, so an installed instance would take a page
screenshot as its icon.

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
3. If present, test torch. No zoom or magnifier control should be shown by the
   scanner.
4. Capture a product: preview freezes, spinner appears only for full analysis,
   Details/retry/close work.
5. Run Try again three times. Effective settings and perceived FOV should stay
   stable; record a screen recording and diagnostics if they change.
6. Test Gallery with the same original photo: spinner immediately, copy only
   after candidate, then aligned results or a clear error.
7. Deny the camera once: the prompt must name the setting to change rather than
   only inviting another retry, and Gallery must stay reachable.

The longer operational checklist remains in
[iphone-camera-verification.md](iphone-camera-verification.md).
