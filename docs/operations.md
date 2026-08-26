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

## Usage metadata measurement

The application does not currently log Gemini usage metadata. A future short
measurement is feature-flagged by `VISION_USAGE_METRICS_ENABLED=true` for a
fixed 14-day window. Log only operation, model, status, duration and token
counters from Gemini `usageMetadata`; aggregate daily, then turn it off and
remove the temporary per-request logging unless it receives an owner and
retention policy.

Full implementation and privacy boundary: [gemini-usage-observability.md](gemini-usage-observability.md).
