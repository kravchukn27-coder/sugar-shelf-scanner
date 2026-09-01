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

Required before enabling: migrations `006_access_passes.sql` and
`007_stripe_payment_ledger.sql` applied, a Stripe
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

### Turning the test on, in order

The order matters. Each step is only meaningful once the one before it is done,
and turning the browser flag on first produces a wall that takes a payment and
then cannot redeem it — which reads as a broken product rather than a missing
step.

1. **Apply the migration.** `psql "$DATABASE_URL" -f db/migrations/006_access_passes.sql`
   against the Railway database. Nothing in the deploy applies it: `npm start`
   only boots the server, so shipping this code creates no table by itself.
   Confirm with `\d access_passes` that the table exists.

2. **Set the server-only secrets in Railway.** `STRIPE_SECRET_KEY` (use the test
   key, `sk_test_...`, for your own run-through; swap to `sk_live_...` only when
   real traffic starts), `ACCESS_PASS_SECRET` (any random string of at least 16
   characters), and `STRIPE_WEBHOOK_SECRET` (created in Stripe after the endpoint
   below is registered). None may ever be given a `NEXT_PUBLIC_` name — that
   prefix inlines a value into the browser bundle, which for a Stripe key would
   publish it. `DATABASE_URL` is already set.

   `ACCESS_PASS_SECRET` is durable for the life of the test: it keys the digest
   of each buyer's email, so rotating it makes every pass already sold
   unrestorable by its buyer.

3. **Check the routes answer before showing anyone a wall.** With the paywall
   still off, `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"email":"nobody@example.com"}' https://sugar-api-production.up.railway.app/api/access/restore`
   should return **404** ("no active pass for that address"), not 503. A 503
   means step 1 or step 2 is incomplete — the routes fail closed on purpose
   rather than half-working.

4. **Turn on the telemetry flags and redeploy.** `SCANNER_METRICS_ENABLED=true`
   and `NEXT_PUBLIC_SCANNER_METRICS_ENABLED=true`. The second is build-time, so
   it needs a redeploy to take effect.

5. **Turn on the paywall and redeploy.** `NEXT_PUBLIC_PAYWALL_ENABLED=true` and
   `NEXT_PUBLIC_STRIPE_PAYMENT_LINK=<the Payment Link URL>`. Both are
   build-time; a variable change alone does nothing until the build reruns.

6. **Buy it yourself, end to end, with the test key.** Three scans until the
   wall appears, then card `4242 4242 4242 4242`, any future expiry, any CVC.
   Expected: Stripe returns you to `/?checkout=cs_test_...`, the address loses
   the `?checkout=` parameter, and the confirmation banner appears. Then check
   the database holds exactly one row: `SELECT count(*) FROM access_passes;`
   Reloading the same success URL must not add a second row — issuing is
   idempotent per checkout session.

   This one run is the highest-value check before spending on traffic. It is the
   only thing that proves the real shape of a Payment Link session: the actual
   length of the session id, whether `customer_details.email` is populated for
   every payment method the link accepts, and what `payment_status` reads for a
   card that requires 3-D Secure.

7. **Prove the restore path.** Open the site in a different browser (or a
   private window), exhaust the free scans, and restore with the address you
   paid with. This is the path that saves a buyer who paid inside the Instagram
   in-app browser and later opened the link in Safari.

8. **Register the Stripe webhook.** In Stripe, add
   `https://<production address>/api/webhooks/stripe`, copy its signing secret
   into Railway as `STRIPE_WEBHOOK_SECRET`, and subscribe to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   and `charge.refunded`. The endpoint verifies the Stripe signature, records
   a compact immutable payment fact, and grants the same seven-day pass even
   if the buyer never returns to the app. Use Stripe's test delivery after
   deployment and expect a 200 response.

   Checkout must collect an email address. A verified paid event without one
   is still retained in the payment ledger for reconciliation, but it cannot
   create a restorable pass because the access model is keyed by the buyer's
   email digest. Treat that as a Stripe Payment Link configuration incident and
   correct the Link before running traffic.

9. **Confirm the funnel is recording.** Look in the Railway logs for a
   `paywall_shown` line. If the wall works but no line appears, step 4 did not
   take effect — and the test would run to completion producing no numbers.

**Rolling back** is one variable: set `NEXT_PUBLIC_PAYWALL_ENABLED=false` and
redeploy. Scanning returns to unlimited immediately; passes already sold simply
stop mattering, and the table can stay until the test is removed for good.

The test deliberately runs on the existing Railway address with no custom
domain. Card details are entered on `checkout.stripe.com`, not here, so the
address never sits under a payment form. The one thing it could affect is Meta
ad review, which rejects raw hosting subdomains more often than ordinary
domains; if that happens, add the domain before spending on traffic rather than
mid-test. The free allowance and passes are per-origin, so a domain move resets
every counter. Paid access survives it — a pass restores by the buyer's email.

Railway variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`ACCESS_PASS_SECRET` are server-only
and must never be given a `NEXT_PUBLIC_` name. `NEXT_PUBLIC_PAYWALL_ENABLED`
and `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` are build-time, so redeploy after
changing them. `ACCESS_PASS_SECRET` is durable: rotating it makes every
existing pass unrestorable by email.

`POST /api/webhooks/stripe` is the source of truth: Stripe signs each delivery,
which is recorded idempotently in `stripe_payment_ledger`; paid Checkout events
also issue an access pass. `POST /api/access/redeem` remains the fast browser
return path and independently verifies a session with Stripe, so the existing
success experience stays unchanged. `POST /api/access/restore` returns an
active pass for the address the buyer paid with and is rate limited.

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
in [gemini-usage-observability.md](gemini-usage-observability.md). When
`ANALYTICS_ENABLED` is off, the intake endpoints write no PostgreSQL rows and
emit only structured stdout logs. When it is on, the same validated events are
also written best-effort to the internal analytics store; a write failure never
changes scanner, paywall, or catalog behaviour. The result intake endpoint is
`POST /api/scan/result-metrics`; it accepts only a fixed allowlist and sends
`Cache-Control: no-store` responses.

The current browser emits `scan_started`, `result_shown`, `product_opened`,
and `recommendation_opened`. The endpoint schema also reserves
`scan_retried` and `scan_abandoned` for a future explicitly implemented
workflow; their presence in the schema does not mean the browser currently
reports them. Only `result_shown` carries coarse result quality (`no_detection`, `unknown_only`,
`estimate_only`, `confirmed_only`, or `mixed`) and a bounded unique displayed
group-count bucket (`0`, `1`, `2_5`, or `6_plus`). Each modern browser build
also attaches a random browser-local installation value solely so the dashboard
can calculate DAU/WAU/MAU. The server HMAC-hashes it with
`ANALYTICS_SUBJECT_SECRET` before writing an event: neither the raw value nor
a user account/email is stored or written to stdout. This measures distinct
browser installations, not people; cleared storage, another browser, or a
different device produces a new installation.

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

## Internal product analytics dashboard

The live internal dashboard is `https://<production address>/admin/analytics`.
It refreshes every 30 seconds and shows best-effort product funnel events,
result quality, pseudonymous DAU/WAU/MAU browser installations, Stripe payment
facts, scanner/Gemini operational metrics and Gemini token-derived estimated
cost. It is not a customer-facing route and its
API returns `Cache-Control: no-store` responses only after a valid bearer
secret.

### First activation

1. Apply migrations in numeric order against the Railway PostgreSQL service:

   ```sh
   psql "$DATABASE_URL" -f db/migrations/006_access_passes.sql
   psql "$DATABASE_URL" -f db/migrations/007_stripe_payment_ledger.sql
   psql "$DATABASE_URL" -f db/migrations/008_product_analytics.sql
   psql "$DATABASE_URL" -f db/migrations/009_analytics_subjects.sql
   ```

   Migrations are manual; deployment does not apply them. `007` must precede
   `008`, because the dashboard reads both the Stripe payment ledger and the
   analytics event store; `009` adds its pseudonymous-installation index.

2. In Railway, add server-only `ANALYTICS_ENABLED=true`, a durable random
   `ANALYTICS_ADMIN_SECRET`, and a separate durable random
   `ANALYTICS_SUBJECT_SECRET`, each at least 16 characters. Keep `DATABASE_URL` as
   the existing Railway reference. Never give any of these variables a
   `NEXT_PUBLIC_` prefix. Redeploy after changing variables.

   Do not rotate `ANALYTICS_SUBJECT_SECRET` while historical unique-installation
   comparisons matter: a new key would generate different hashes for the same
   browser and split the time series.

3. For browser funnel/quality data, also set
   `SCANNER_METRICS_ENABLED=true` and
   `NEXT_PUBLIC_SCANNER_METRICS_ENABLED=true`; the latter is embedded at build
   time, so it requires a rebuild/redeploy. For Gemini tokens and estimated
   cost, set `VISION_USAGE_METRICS_ENABLED=true`.

4. Open `/admin/analytics` and enter `ANALYTICS_ADMIN_SECRET`. The secret is
   held only in the current browser tab and sent over HTTPS as a bearer header;
   do not share the route or secret publicly.

5. Before sending traffic, make one synthetic scan and one Stripe test payment.
   Within 30 seconds, verify that the dashboard timestamp advances, the funnel
   records the scan, and the Stripe payment count/revenue reconcile with the
   Stripe test event.

### Actual Google Cloud billed spend (optional)

The dashboard can supplement its immediate application-side Gemini token-cost
estimate with actual Cloud Billing data. This source is not real time: Cloud
Billing export may take hours to create its table and can lag behind the latest
usage. Values whose latest reported usage is more than 36 hours old are marked
**stale**, never current. It reports a project-wide Google total and a
heuristic Gemini subset whose service/SKU name contains `gemini` or
`generative language`; it includes credits.

1. Enable **Standard usage cost** export to BigQuery dataset `sugar_billing`
   in project `gen-lang-client-0349591718` (already the selected production
   project). Do not enable Detailed usage cost for this dashboard.
2. After Google creates `gcp_billing_export_v1_<BILLING_ACCOUNT_ID>`, create a
   dedicated service account. Grant it `BigQuery Data Viewer` on
   `sugar_billing` and `BigQuery Job User` on project
   `gen-lang-client-0349591718`; grant no Billing Administrator or write role.
3. Create one JSON key for that account, Base64-encode the complete JSON file,
   and add these server-only Railway variables:

   ```text
   GOOGLE_CLOUD_BILLING_PROJECT_ID=gen-lang-client-0349591718
   GOOGLE_CLOUD_BILLING_DATASET_ID=sugar_billing
   GOOGLE_CLOUD_BILLING_SERVICE_ACCOUNT_JSON_BASE64=<base64 JSON key>
   ```

   On macOS, copy the encoded value to the clipboard without printing it by
   running `base64 -i /absolute/path/to/key.json | pbcopy`. Do not commit the
   JSON file or give any variable a `NEXT_PUBLIC_` prefix.

4. Redeploy. The dashboard makes an aggregate read at most once every ten
   minutes per running process, including while export data is unavailable,
   and displays waiting, empty, stale, or unavailable states rather than
   presenting missing data as zero.

Gemini spend on this page is an application-side estimate from provider token
metadata, not the Cloud Billing invoice. The Gemini 3.6 Flash standard-price
version used in code is documented in
[Google's Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
and is explicitly versioned in the event. If the Railway model, pricing tier or
listed rate changes, update the pricing implementation and its test before
re-enabling the dollar card. Actual Google billed cost and live quota limits
require a separately authorised Google Cloud/AI Studio integration; until then
the dashboard labels them as unavailable rather than inventing a value.
