# Scanner product and UX contract

## Main flow

1. **Start** opens the live rear-camera scanner.
2. A small preflight decides whether a packaged food/drink is a candidate.
   `none` and `uncertain` remain live; only a candidate can trigger capture.
3. One full-analysis frame freezes while Gemini identifies visible packaging.
   The analysis state uses a compact branded glass status with a persistent
   privacy note.
4. A completed scan opens results immediately: multiple products open the
   comparison list, while one product opens its Sugar Fit card. If the user
   collapses results, a centred branded handle remains available to reopen it.
5. **Details** exposes source, sugar/protein and the clear distinction between
   `Confirmed`, `AI estimate` and unknown.
6. Retry or close returns to a stable live scanner.

The frozen image is the full-analysis capture, not a second camera view. Raw
frames are not retained by the application.

## State-specific controls

| State | Gallery | Barcode action | Notes |
| --- | --- | --- | --- |
| `camera_off` | hidden | hidden | Start is the entry point. |
| `live_searching` | available | hidden | Torch is shown only when the selected track reports support. |
| `captured_analyzing` | hidden | hidden | Spinner is visible only during full Gemini analysis. |
| `results` | hidden | hidden | Details opens from the centred result handle. |
| `no_scene` / error | as applicable | top-bar recovery only | Barcode is not a camera-switch control. |

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
