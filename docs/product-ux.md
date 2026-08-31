# Scanner product and UX contract

## First visit

The onboarding story at `/onboarding/sugar-investor-demo.html` plays once per
browser, before the scanner. It runs four auto-advancing scenes and ends on a
screen whose **Start scanning** hands control back to the app; the story is
never dismissed on a timer, so the last scene waits.

Completion is remembered in `localStorage` under `sugar:onboarding-seen:v1`.
A storage failure — private mode, blocked site data — falls through to showing
the story rather than swallowing it, so a first-time visitor is never dropped
straight into a camera prompt with no context. The idle home screen keeps a
**Replay intro** entry point, which does not clear the stored flag.

Because the flag is per browser and per origin, someone who has already opened
the production link will not see the story again. Forcing it back for everyone
means bumping the key, not clearing state at runtime.

## Paid access (monetization test)

The scanner allows three completed scans per browser, then shows a wall
offering seven days of unlimited scanning for a single $2.99 payment. Only a
scan that produced a result consumes the allowance: a failed or empty scan is
not the user's fault and must not be charged for.

The allowance lives in `localStorage` under `sugar:free-scans:v1` and resets
when the user switches browsers or clears site data. That is deliberate — a
scan costs a fraction of a cent, and server-side identity would cost more in
conversion than the tokens it saves, while conflicting with the no-identifier
telemetry contract.

A purchase behaves differently. It is stored server-side, keyed to a digest of
the buyer's email, and restorable from any browser through **Already paid on
another browser?** on the wall. This exists because an ad click opens in the
Instagram in-app browser, whose storage is isolated from Safari: without a
restore path a buyer who reopens the link elsewhere would lose what they paid
for.

The remaining free count is never shown. A visible counter turns a trial into
rationing, and the test needs the opposite — people scanning as much as they
actually want to.

The whole feature is off unless the build carries
`NEXT_PUBLIC_PAYWALL_ENABLED=true`. See
[monetization-test.md](monetization-test.md).

## Main flow

1. **Start** opens the live rear-camera scanner.
2. A small preflight decides whether a packaged food/drink is a candidate.
   A candidate triggers capture automatically. On the live camera `uncertain`
   stays live with a hint, while `none` is terminal and shows the blocking
   "No packaged products detected" prompt — a deliberate token guard for a
   genuinely empty scene.
3. **Analyze now** is the manual override: it captures the current frame and
   goes straight to full analysis without waiting for a preflight verdict. A
   preflight request already in flight is abandoned, because it is only a gate
   opinion the user has just overruled; a full analysis already running is
   never interrupted. Because a `none` verdict is terminal, the shutter is
   reachable while preflight is still running or `uncertain`, not after the
   scene has already been rejected.
4. One full-analysis frame freezes while Gemini identifies visible packaging.
   The analysis state uses a compact branded glass status with a persistent
   privacy note.
5. A completed scan opens results immediately: multiple products open the
   comparison list, while one product opens its Sugar Fit card. If the user
   collapses results, a centred branded handle remains available to reopen it.
6. **Details** exposes source, sugar/protein and the clear distinction between
   `Confirmed`, `AI estimate` and unknown.
7. Retry or close returns to a stable live scanner.

The frozen image is the full-analysis capture, not a second camera view. Raw
frames are not retained by the application.

The blurred surround, live and frozen alike, is drawn at the viewfinder's own
scale and centre, so it continues the framed picture rather than repeating it
enlarged. Where the projection runs past the source the nearest edge pixels are
stretched. Only what the frame encloses is analyzed; the surround is context,
marked as such by the frame edge, the blur and the darkening.

## State-specific controls

| State | Gallery | Analyze now | Barcode action | Notes |
| --- | --- | --- | --- | --- |
| `camera_off` | hidden | hidden | hidden | Start is the entry point. |
| `live_searching` | available | available | hidden | Torch is shown only when the selected track reports support. |
| `captured_analyzing` | hidden | hidden | hidden | Spinner is visible only during full Gemini analysis. |
| `results` | hidden | hidden | hidden | Details opens from the centred result handle. |
| `no_scene` / error | as applicable | hidden | top-bar recovery only | Barcode is not a camera-switch control. |

**Analyze now** is a centred pill in the bottom band below the viewfinder,
sharing that band and its baseline with the gallery button on the left. It
never overlaps the frame. It stays disabled until the viewfinder has painted
its first frame, and it is hidden while a gallery image is being analyzed, so
it never captures a frame the user cannot see.

The default scanner never presents a separate barcode mode. The no-scene/error
button starts a recovery path only, using a local decoder.

## Results and overlays

- Overlay labels contain only `Low`, `Moderate`, `High`, `Very high` or `Check`.
  Sugar values, source and estimate status live in Details.
- Repeated confirmed SKU detections are grouped by stable catalog ID; compatible
  estimates are grouped only when brand, name, pack size, sugar and band match.
- `Confirmed` nutrition comes from the catalog. An AI visual estimate may be
  colour-banded, but must remain explicitly labelled as an estimate.
- The bottom handle is centred in the scanner viewport and leaves safe-area
  space for other controls.

## Gallery/upload contract

Immediately after choosing a file, show the spinner. Keep it through image
load, preflight and full analysis. Show “Product found — checking details…”
only after positive preflight begins full analysis. Upload and live paths use
the same resolution, crop, timeout and catalog-resolution policies. Detection
boxes are mapped from the analysed crop back to the visible `object-fit: cover`
preview.

## Contextual recovery

For `estimate` or `unknown`, Details can ask the user to turn the pack around.
The browser reads EAN/UPC locally from a single recovery photo. A valid GTIN
may be sent to `/api/scan/recover`; the recovery image itself is not sent for
barcode lookup. If the barcode is not recognised or is absent from the
confirmed catalog, the user can consent to send that captured image to Gemini
or choose a dedicated nutrition-label capture.

Nutrition-label extraction is a separate, one-shot Gemini request. Before that
photo is sent, the app asks for explicit consent and sends it only when the
user agrees. The application does not persist recovery photos, video frames,
or extracted label text. A returned draft remains provisional until the user
reviews it and submits it for curator review; it does not alter the confirmed
catalog or the original confirmed result. Barcode failure is an
availability/readability failure, not evidence that a product does not exist.

User contribution is an explicit, review-pending action after an unresolved
locally decoded barcode. It never changes the current scan or confirmed catalog.
See
[catalog-data.md](catalog-data.md).
