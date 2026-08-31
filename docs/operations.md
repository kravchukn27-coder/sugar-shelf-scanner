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

## Paid access (monetization test)

Required before enabling: migration `006_access_passes.sql` applied, a Stripe
Payment Link whose after-payment redirect is
`https://<production address>/?checkout={CHECKOUT_SESSION_ID}`, and both
telemetry flags — `SCANNER_METRICS_ENABLED=true` in Railway **and**
`NEXT_PUBLIC_SCANNER_METRICS_ENABLED=true` in the deployed browser build. The
funnel events `paywall_shown`, `paywall_checkout_started` and `access_granted`
travel through `POST /api/scan/result-metrics`, which discards everything
unless both flags are set — so without them the wall works perfectly and the
funnel, which is the entire point of this test, records nothing.

Do not enable promotion codes on this Payment Link. A fully discounted checkout
returns Stripe's `payment_status: no_payment_required`, which redemption treats
as unpaid, so that buyer is refused access with a 402.

Launch check: before spending money on traffic, open the wall once on the
deployed build and confirm a `paywall_shown` event actually appears in the
Railway logs.

The test deliberately runs on the existing Railway address with no custom
domain. Card details are entered on `checkout.stripe.com`, not here, so the
address never sits under a payment form. The one thing it could affect is Meta
ad review, which rejects raw hosting subdomains more often than ordinary
domains; if that happens, add the domain before spending on traffic rather than
mid-test. The free allowance and passes are per-origin, so a domain move resets
every counter. Paid access survives it — a pass restores by the buyer's email.

Railway variables: `STRIPE_SECRET_KEY` and `ACCESS_PASS_SECRET` are server-only
and must never be given a `NEXT_PUBLIC_` name. `NEXT_PUBLIC_PAYWALL_ENABLED`
and `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` are build-time, so redeploy after
changing them. `ACCESS_PASS_SECRET` is durable: rotating it makes every
existing pass unrestorable by email.

There is no webhook and no Stripe SDK. `POST /api/access/redeem` asks Stripe
once whether the returned session was paid and issues the pass; issuing is
idempotent per checkout session. `POST /api/access/restore` returns an active
pass for the address the buyer paid with and is rate limited.

Refunds are issued in the Stripe dashboard on first request without argument.
A demo that fails to find a product has already cost the buyer their goodwill;
a chargeback and a public review cost more than $2.99.

To turn the test off: set `NEXT_PUBLIC_PAYWALL_ENABLED=false` and redeploy —
the scanner returns to unlimited free scanning immediately, and existing passes
simply stop mattering. To remove it entirely: delete `src/lib/access/`,
`src/app/api/access/`, `src/app/paywall.tsx`, `src/app/paywall.module.css`,
their call sites in `src/app/page.tsx`, and drop the `access_passes` table.

## Privacy-safe scanner telemetry

Scanner telemetry is implemented but disabled by default. It includes
scanner-stage summaries and P0 product-funnel/result-quality events. Enable it
only when `SCANNER_METRICS_ENABLED=true` is set in Railway **and**
`NEXT_PUBLIC_SCANNER_METRICS_ENABLED=true` is present in the deployed browser
build. The latter is a build-time variable, so redeploy after changing it.
The browser also requires the `X-Scanner-Metrics: enabled` capability header
on an active scan response; either flag or the missing header prevents browser
event intake.

Before enabling, confirm Railway log retention and access controls, designate
an observation owner, and perform the disabled/enabled browser network checks
in [gemini-usage-observability.md](gemini-usage-observability.md). The intake
endpoints write no PostgreSQL rows. Validated events are emitted only as
structured stdout logs: `scanner_completed` for stage summaries and
`scan_result_metric` for funnel/quality events. The result intake endpoint is
`POST /api/scan/result-metrics`; it accepts only a fixed allowlist and sends
`Cache-Control: no-store` responses.

The current browser emits `scan_started`, `result_shown`, `product_opened`,
and `recommendation_opened`. The endpoint schema also reserves
`scan_retried` and `scan_abandoned` for a future explicitly implemented
workflow; their presence in the schema does not mean the browser currently
reports them. Only `result_shown` carries coarse result quality (`no_detection`, `unknown_only`,
`estimate_only`, `confirmed_only`, or `mixed`) and a bounded unique displayed
group-count bucket (`0`, `1`, `2_5`, or `6_plus`). Do not add identifiers,
product data, image data, timestamps, or free-form values to this contract.

## Temporary Gemini token-usage diagnostic

Gemini usage metadata is separate from scanner telemetry and is controlled
only by the server-side `VISION_USAGE_METRICS_ENABLED=true` flag. It logs
operation, model, status, duration, and provider token counters after a
completed Gemini response. It does not enable any browser telemetry.
`vision_request` timing/outcome events remain independent.

Use this flag only for a defined diagnostic period. Aggregate the necessary
logs by UTC day, then disable it. Keep `vision_usage` logging only when it has
a documented operational owner and retention policy.

Full implementation and privacy boundary: [gemini-usage-observability.md](gemini-usage-observability.md).
