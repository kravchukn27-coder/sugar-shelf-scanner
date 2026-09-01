# Sugar Shelf Scanner

Sugar Shelf Scanner is a mobile-first demo for scanning packaged food and
showing how the visible products fit a sugar-oriented result view. It supports
the live rear camera and image upload, a two-stage vision flow, reviewed
catalog matches, clearly labelled AI estimates, and a local-first recovery
flow for barcodes and nutrition labels.

This repository is a demo, not a nutrition or medical product. Results can be
incomplete or incorrect; users should check the package label before making a
health or dietary decision.

## Run locally

Requires Node.js 20.9 or newer.

```sh
npm install
cp .env.example .env.local
npm run dev
```

The example environment uses `VISION_PROVIDER=mock`, so it starts without
external credentials and produces deterministic scan responses. Open
`http://localhost:3000` for the scanner. The presentation paths are available
at `http://localhost:3000/?demo=sugar-fit` and
`http://localhost:3000/?demo=sugar-fit-multi`.

To use Gemini, set `VISION_PROVIDER=gemini` and provide `GEMINI_API_KEY` in
`.env.local`. See [the environment template](.env.example) and
[operations.md](docs/operations.md) before configuring production services.

## Current demo scope

- Live camera and gallery scan flows with client-side frame-quality guidance.
- Gemini preflight and full-package analysis, with deterministic mock fixtures
  for local development and demos.
- Sugar Fit result cards, comparison results, and an explicit distinction
  between catalog-confirmed data, AI estimates, and unknown values.
- Reviewed catalog data with optional PostgreSQL persistence and public-data
  fallbacks.
- Local barcode decoding plus an opt-in recovery/contribution flow for
  unresolved products.

The reviewed catalog is intentionally limited. A visible product is not
automatically a confirmed catalog match, and AI-derived nutrition is never a
substitute for the package label.

## Privacy and telemetry

Raw camera frames are processed for the active scan and are not retained by the
application. Operational telemetry and P0 funnel/quality analytics are opt-in;
when durable analytics is enabled, safe event summaries are stored in the
existing PostgreSQL service and are available on the protected internal
dashboard. They do not include images, OCR text, Gemini prompt/output content,
payment-card data, or readable buyer email addresses.

The dashboard's DAU/WAU/MAU values count distinct pseudonymous browser
installations, rather than verified people. A random value stays in browser
storage and is HMAC-hashed on the server before persistence; the raw value is
never logged or stored. Clearing browser storage or switching device/browser
creates a new installation.

Browser funnel data stays disabled until both `SCANNER_METRICS_ENABLED=true` on
the server and `NEXT_PUBLIC_SCANNER_METRICS_ENABLED=true` in the browser build
are set. Durable storage also requires server-only `ANALYTICS_ENABLED=true` and
`ANALYTICS_ADMIN_SECRET`; Gemini token usage additionally requires
`VISION_USAGE_METRICS_ENABLED=true`. Unique-installation counts additionally
require durable server-only `ANALYTICS_SUBJECT_SECRET`. The public variable is evaluated during
the build, so changing it requires a new deployment. Details, migrations and
the dashboard launch checklist are in [operations.md](docs/operations.md) and
[gemini-usage-observability.md](docs/gemini-usage-observability.md).

## Verify

```sh
npm test
npm run typecheck
npm run verify
```

`npm run verify` performs a clean production build and type check.

## Documentation

Start with the [documentation map](docs/README.md). It links the scanner UX,
camera behavior, catalog policy, operations, telemetry, and archived planning
context.
