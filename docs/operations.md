# Operations and release runbook

## Production

- Service: `https://sugar-api-production.up.railway.app`
- Source branch: `main`
- Health endpoint: `/api/health`
- Required server credentials remain server-only. Never expose Gemini keys,
  database URLs or source identifiers to the browser.

## Deploy gate

Before each deploy run:

1. `npm test`
2. `npm run verify`
3. `git diff --check`
4. Catalog fixtures, especially strict false-confirmation cases.
5. Privacy review: no raw frames, base64, OCR, product identity, GTIN, camera
   identifiers or prompt/output content added to production logs.
6. Manual iPhone path where camera code changed: Start → capture → result /
   Details → recovery → retry/close; torch and optional zoom only if available.

## PostgreSQL activation

Follow [catalog-data.md](catalog-data.md#production-activation-checklist).
Applying schema and importing reviewed rows are operational steps; they require
the actual Railway production `DATABASE_URL`. Do not declare the database layer
active merely because the variable exists.

After import, smoke test confirmed results, an incorrect pack/variant, DB
fallback behaviour and recovery. Keep the reviewed curated seed enabled as the
safe fallback.

### Production activation record — 26 August 2026

- Migrations `001_catalog_foundation.sql`, `002_reviewed_catalog.sql`, and
  `003_catalog_proposals.sql` were applied to the Railway PostgreSQL service.
- The approved Spain import completed with 19 reviewed products.
- Production health confirmed the active database catalog:

  ```json
  { "catalog": { "state": "ready", "reviewedProductCount": 19, "importComplete": true } }
  ```

- Database credentials were rotated after the operational setup. App services
  must continue to use a Railway reference variable for `DATABASE_URL` and be
  redeployed after a future credential rotation; never paste a connection URL
  into the app's Variables.

## Usage metadata measurement

Scanner-stage measurement is implemented but disabled. Enable it only for an
approved 14-day window with both `SCANNER_METRICS_ENABLED=true` in Railway and
`NEXT_PUBLIC_SCANNER_METRICS_ENABLED=true` in the deployed browser build. The
browser still requires a server capability header, so either flag can stop
intake. Before enabling, verify Railway log retention/access controls and run
the iPhone disabled/enabled network checks in
[gemini-usage-observability.md](gemini-usage-observability.md).

Gemini usage metadata remains separately controlled by the server-only
`VISION_USAGE_METRICS_ENABLED=true`. It logs only operation, model, status,
duration and provider token counters; `vision_request` timing/outcome events
are separate. Aggregate both streams daily by UTC day, then turn all three
measurement flags off and remove `vision_usage` logging unless it receives an
owner and retention policy.

Full implementation and privacy boundary: [gemini-usage-observability.md](gemini-usage-observability.md).
