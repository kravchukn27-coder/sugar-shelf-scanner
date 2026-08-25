# Design reference — Sugar.no redesign

Two static HTML docs, open directly in a browser (no build step).

- **`sugar-no-brand-book.html`** — palette, type scale, components, and a full
  camera-screen anatomy extracted from the reference app *Sugar.no – Blood
  Sugar Tracker* (App Store id `6744766266`), from six user-supplied
  screenshots. Colors marked "estimated" were read visually, not
  pixel-sampled.
- **`sugar-shelf-scanner-redesign.html`** — all six states of the Sugar Shelf
  Scanner demo (`camera_off`, `live_searching`, `captured_analyzing`,
  `results`, `results` + sheet, `no_scene`/`error`), restyled to match the
  brand book above. Audited against the brand book for token drift and
  cross-screen consistency.

Neither file is wired to the app — they're mockups for sign-off before
porting the direction into `src/app/globals.css` / `src/app/page.tsx`.
