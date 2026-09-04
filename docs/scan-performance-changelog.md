# Scan performance changelog

## Purpose

A running log of scan-pipeline changes (preflight/analyze latency, errors,
tokens, catalog sources) paired with the Railway-log baseline that motivated
each one. The goal is to be able to answer "did this actually help?" later by
re-pulling logs over a comparable window and filling in the **Result**
section of the matching entry, instead of relying on memory or vibes.

This is a hand-maintained decision log, not a telemetry system — see
[`gemini-usage-observability.md`](./gemini-usage-observability.md) for what
the app actually logs and how to pull it from Railway.

## How to use this file

1. Before shipping a scan-pipeline change, add a new entry under **Change
   log** with: date, commit, what changed, the metric it targets, and the
   baseline value for that metric (pull from Railway logs — see the query
   recipe below).
2. After the change has been live long enough to accumulate a comparable
   sample (rule of thumb: similar order-of-magnitude request count to the
   baseline window), pull logs again over the new window and fill in
   **Result**. Mark the entry `✅ improved`, `➖ no measurable change`, or
   `❌ regressed`.
3. Never delete an entry, even a regression — a documented miss is what
   stops the same idea from being re-tried blind next time.

### Query recipe (Railway CLI)

The app logs structured JSON events to stdout (`event: "scan_request"`,
`"vision_request"`, `"vision_usage"`, `"catalog_resolution"`,
`"catalog_source_request"`, `"scanner_completed"`, `"scan_result_metric"` —
see `gemini-usage-observability.md` for field shapes). Each Railway redeploy
starts a fresh log buffer, so to cover a real window you generally need to
pull per-deployment:

```bash
railway deployment list --service sugar-api --limit 200 --json > deployments.json
# filter deployments.json to the window you want, then for each id:
railway logs "<deployment-id>" --deployment --json </dev/null >> window.jsonl
```

`</dev/null` matters — running this inside a `while read` loop over a file of
IDs otherwise lets `railway` inherit that same stdin and hang. Skip the
currently-active deployment (it streams live; use `--since`/`--lines`
instead, or fetch it separately).

Then join `catalog_resolution` → `scan_request` (route `analyze`) by log
order per request to get detection count alongside timing — they're logged
as two consecutive lines per request but do not share a timestamp.

## Baseline: 2026-08-26 19:36 UTC → 2026-08-27 20:59 UTC (~25h, pre-changes below)

Collected from ~66 Railway deployments (active dev iteration day, so this is
mostly the developer's own test traffic, not real users — still a valid
before/after baseline since the same is true of any comparison window until
this app has real production traffic).

| Metric | Value |
| --- | --- |
| Scan requests | 291 (206 preflight, 82 analyze, 3 recovery_label) |
| `scan_request` status | 200: 81.1% · 504: 12.4% · 502: 3.4% · 499: 3.1% |
| `analyze` durationMs | p50 4.7s · p90 17.0s · max 34.4s |
| `analyze` visionMs | p50 3.3s · p90 14.0s · max 32.9s |
| `preflight` durationMs | p50 2.7s · p90 5.2s · max 10.1s |
| `vision_request` outcomes | success 81% · provider_timeout 12.4% · client_cancelled 3.1% · invalid_provider_response 2.7% · provider_error 0.7% (timeouts concentrated in `preflight`) |
| Open Food Facts catalog source | 50.3% success, avg 728ms |
| USDA catalog source | 93.4% success, avg 225ms |
| Gemini tokens (post `VISION_USAGE_METRICS_ENABLED`, from 08-27 09:17 UTC) | 109 successful calls, avg 1585 tokens/call (analyze avg ~1928, preflight avg ~1436) |
| detections (analyze) vs visionMs correlation | Pearson r ≈ 0.41 — real but partial; long tail (30s+) occurs even at 2-4 detections, not only on crowded shelves |

## Change log

### 2026-08-27 — [`52bc5b4`](../../commit/52bc5b4) — Extended-wait copy for slow analyze scans

**Change:** Added a 4th `analysisPhase` tier ("extended") at 15s, with copy
"This one's taking a bit longer than usual" — was previously stuck on
"Still working on your result" from 7s all the way to 30s+ in the observed
tail. Client-only (`src/app/page.tsx`), no server/timing change.

**Target:** Perceived-wait UX during the p90+/tail of `analyze` (14-34s per
baseline). Not expected to move any server-side metric.

**Result:** _(no client-side "did this feel long" signal exists yet to
measure this against — would need a UX/qualitative check, not a log pull.
Leave open.)_

### 2026-08-27 — [`efa967d`](../../commit/efa967d) — Upfront crowded-shelf warning

**Change:** Preflight's `packagedProductCount` is now passed into
`analyze()`; when ≥10, the analyzing screen shows "Full shelf detected —
this may take a moment" from t=0 instead of the generic "Calculating Your
Fit". Client-only.

**Target:** Same perceived-wait UX goal, specifically for the subset of
scans (10-20 detections) whose baseline median was already 9-11s — i.e.
warn before the wait starts, not after 15s.

**Baseline for this subset:** detections 10-14 → median 9.2s (max 32.9s);
detections 15-19 → median 11.2s; detections 20 → median 10.2s.

**Result:** _(pending — needs the same detections-bucketed pull as the
baseline table above, re-run over a post-deploy window)_

### 2026-08-27 — pending commit — Speculative hedge retry for small shelves

**Change:** `src/lib/vision/gemini.ts` — when an `analyze` call's
`expectedProductCount < 10` (passed from preflight; gallery uploads never
set it and are unaffected), fire one duplicate parallel Gemini call after
`GEMINI_HEDGE_DELAY_MS = 7_000`ms if the primary hasn't answered yet, and
take whichever settles first. Logged via `vision_request.hedge`:
`"primary_won"` (eligible, hedge not needed or lost) / `"hedge_won"`
(duplicate call answered first) / absent field (not eligible for a hedge at
all — crowded shelf or unknown count).

**Why this shape, not a lower timeout:** the baseline data showed cutting
`GEMINI_TIMEOUT_MS` would have killed real successful scans (9 of 78
successful `analyze` calls took ≥12s, 7 took ≥15s, up to 32.9s) — these are
valid slow-but-successful Gemini responses, not the failure tail. A hedge
avoids that tradeoff: it only spends extra tokens on requests that are
*already* running long, and only where the extra cost has a real chance of
paying off.

**Why gated on expectedProductCount, not applied to every slow call:** the
detections-vs-visionMs correlation (r≈0.41, table above) means large-shelf
slowness is partly structural — Gemini has to generate a genuinely longer
response, so a duplicate call would likely be similarly slow and just double
token spend for nothing. The two worst outliers in the baseline (32.9s,
32.9s) were on shelves with only 2 and 13 detections — i.e. the true random
long tail shows up disproportionately on *small* shelves, which is exactly
where a duplicate call has a real chance of finishing near the ~2.8s median
for that bucket instead of the outlier's 30s+.

**Target metrics to check in the Result below:**
- `vision_request` events where `operation:"analyze"` and `hedge` is
  present: what fraction is `"hedge_won"` (tells us how often the primary
  really was the slow one, vs. the hedge just wasting tokens because the
  primary was about to finish anyway).
- p90/max `durationMs` for `analyze` requests with `expectedProductCount <
  10`, compared against this baseline's low-detection-count bucket (0-4:
  median 2.8s, max 32.9s) — the max should come down meaningfully if this
  is working.
- Rough token-cost delta: hedge calls that fire consume tokens even when
  they lose the race (both are logged via `vision_usage`), so compare total
  `vision_usage` token sum growth against the `analyze` request count growth
  over the same window — a large jump in tokens-per-request suggests the
  hedge is firing too often relative to the benefit.

**Result:** _(pending — needs a fresh log pull once this has been live long
enough to accumulate a few dozen small-shelf `analyze` calls)_

### 2026-08-30 — investigation follow-up — Gemini incident resolved

**Check:** re-pulled logs from the current deployment (`80e52276`, live since
08-29 06:41 UTC, so its logs span all of 08-29 and 08-30 to date) to see
whether the 08-27/08-28 external Gemini incident (previous entry above) had
self-resolved.

| Window | n | success | preflight p50 | preflight timeout% |
| --- | --- | --- | --- | --- |
| Incident (27.08 21:00 → 28.08 14:22) | 103 | 43.7% | 4.8s | 42.7% |
| 29.08 | 43 | 79% | 2.4s | 7.4% |
| 30.08 (partial day, n small) | 11 | 91% | 4.0–4.5s | 1/6 |

Token usage stayed flat (preflight avg 1421, analyze avg 1590 — consistent
with the 1436/1928 baseline), confirming this was never a payload-side
issue. 29.08's numbers are back at (in fact slightly better than) the
original healthy baseline. 30.08's sample is too small for real confidence
yet, but shows no failure pattern.

**Result:** ✅ resolved — no code or config change was involved; the
external Gemini-side degradation identified on 08-28 appears to have
cleared on its own by 08-29. Worth a larger-sample re-check later in the day
on 08-30 once more traffic accumulates, but nothing actionable right now.

### 2026-09-01 — [`de2a30f`](../../commit/de2a30f) — Preflight dropped to Gemini 3's "minimal" thinking level

**Change:** `src/lib/vision/gemini.ts` — `thinkingConfigFor` now takes a
level argument; `preflightWithGemini` passes `"minimal"` instead of the
previous hardcoded `"low"`. `analyzeWithGemini` is unchanged (still `"low"`).

**Why:** research turned up that Gemini 3.x actually has a 4-tier
`thinkingLevel` scale (minimal/low/medium/high), not the 2-tier low/high
this code assumed — `gemini-3.6-flash`'s own default is `"medium"`.
`"minimal"` is the level Google's docs recommend for classification-shaped
calls and the closest analog to 2.5's full `thinkingBudget: 0` disable.
Preflight is pure candidate/none/uncertain + count classification, explicitly
forbidden from identifying brands or estimating nutrition, so it has nothing
to lose from less reasoning. Triggered by today's preflight success rate
badly degraded (see the 09-01 investigation entry below) and 50%+ timeout
hours — a real lever worth trying alongside, not instead of, chasing the
external incident.

**Rollback:** pass `"low"` (or omit the second argument) at the preflight
call site.

**Result:** _(pending — needs a same-day before/after read once traffic
accumulates past the day's external-incident noise)_

### 2026-09-01 — [`ebae071`](../../commit/ebae071) — `MEDIA_RESOLUTION_MEDIUM` for preflight

**Change:** `src/lib/vision/gemini.ts` — added `mediaResolution:
"MEDIA_RESOLUTION_MEDIUM"` to preflight's `generationConfig`. Previously no
value was set (provider default). Analyze is unchanged.

**Why:** a full low-resolution preflight tier was tried once before (see
the standing comment in the code) and rolled back for regressing
recognition of small packaged products. `MEDIUM` is a documented middle
ground (560 image tokens vs the unspecified default) rather than that same
low tier — not assumed equivalent, so it gets its own before/after read.

**Rollback:** delete the `mediaResolution` line.

**Result:** _(pending — same as above, needs traffic past today's incident
noise)_

### 2026-09-01 — [`c139b13`](../../commit/c139b13) — Concurrent 50/50 preflight model A/B test: `gemini-3.6-flash` vs `gemini-3.5-flash-lite`

**Change:** `src/lib/env.ts` adds `GEMINI_PREFLIGHT_MODEL_VARIANT_B`
(optional). `src/lib/vision/gemini.ts`'s `preflightWithGemini` now resolves
the model once per call — a 50/50 random pick between `GEMINI_PREFLIGHT_MODEL`
(model A) and `GEMINI_PREFLIGHT_MODEL_VARIANT_B` (model B) when the variant
is set, otherwise always model A (no-op, matches prior behavior exactly).
The chosen model is threaded through the fetch URL and every log line, so a
single request's telemetry never mixes two model names.

**Why concurrent, not sequential:** the earlier `gemini-2.5-flash` /
`gemini-3.6-flash` comparisons and the incident investigations above were
all sequential (deploy A, wait, deploy B) and got confounded by Gemini's own
latency drifting hour to hour — see the 09-01 hourly preflight table in the
investigation entry below (67% success at 07:00 UTC → 20-25% by 10:00-12:00,
same day, same code). A concurrent split puts both models under identical
external conditions in the same window, which the sequential approach
cannot do.

**Live since:** 2026-09-01, ~15:00 UTC (Railway variables:
`GEMINI_PREFLIGHT_MODEL_VARIANT_B=gemini-3.5-flash-lite`,
`GEMINI_VISION_MODEL=gemini-3.6-flash` as model A).

**Rollback:** unset `GEMINI_PREFLIGHT_MODEL_VARIANT_B` on Railway — the split
code becomes fully inert, same as before this commit.

**Where to check results:** `/admin/analytics` → Gemini Health → Models
panel — will show both model rows once each has accumulated live traffic
(zero data at deploy time; the panel's "Seven-day breakdown" only reflects
persisted events from before the split went live until fresh scans happen).

**Result:** ✅ closed — see the 2026-09-02 decision entry below. Full-window
Postgres data (`analytics_events`, 09-01 + 09-02, 140 preflight requests):
`gemini-3.5-flash-lite` 79.6% success / 4 timeouts (7%) / p50 1.4s vs
`gemini-3.6-flash` 48.8% success / 29 timeouts (34%) / p50 3.2s.
`gemini-3.5-flash-lite` wins decisively on every metric.

### 2026-09-01 (update) — Preflight A/B: early data, and analyze A/B added

**Preflight A/B result so far:** first ~15 minutes after the split went
live (~15:00 UTC), 12 preflight requests split 5/7 between the two models:

| Model | n | Outcome |
| --- | --- | --- |
| `gemini-3.6-flash` | 5 | 5/5 `provider_timeout`, all at 5001-5005ms (the exact ceiling) |
| `gemini-3.5-flash-lite` | 7 | 5 success (1.2-2.3s), 1 timeout, 1 client_cancelled |

Same window, `analyze` (still `gemini-3.6-flash` only at that point): 4
requests, 0 successes (3 timeout, 1 client_cancelled). Sample is small, but
the contrast is qualitative, not marginal — `gemini-3.6-flash` looked
completely non-responsive in this window on both operations, while
`gemini-3.5-flash-lite` mostly worked and fast. Not enough data yet to
close this entry; logged here so the pattern is on record before more
traffic accumulates and possibly muddies it.

### 2026-09-01 — [`279b5da`](../../commit/279b5da) — Concurrent 50/50 analyze model A/B: `gemini-3.6-flash` vs `gemini-3.5-flash-lite`

**Change:** same mechanism as the preflight split (`c139b13`), applied to
`analyzeWithGemini`. New env var `GEMINI_ANALYZE_MODEL_VARIANT_B`. The
chosen model is threaded through the primary attempt, its hedge duplicate,
and the one transport-failure retry, so one logical scan never mixes two
models and a hedge race never crosses model A with model B.

**Why:** triggered directly by the preflight A/B result above — with
`gemini-3.6-flash` looking non-responsive on `analyze` too (0/4 that
window), it was worth measuring analyze the same concurrent way instead of
guessing from preflight's numbers or switching analyze over blind.

**Live since:** 2026-09-01, ~17:15 UTC (Railway variable:
`GEMINI_ANALYZE_MODEL_VARIANT_B=gemini-3.5-flash-lite`). Preflight's split
(`GEMINI_PREFLIGHT_MODEL_VARIANT_B`) has been live since ~15:00 UTC.

**Rollback:** unset `GEMINI_ANALYZE_MODEL_VARIANT_B` on Railway.

**Caveat:** `gemini-3.5-flash-lite` was not designed for analyze's task
(detailed multi-product detection with bounding boxes, brand/name, sugar
estimates) the way it was for preflight's simple classification — this A/B
needs to be read for *both* speed and detection quality, not speed alone,
before considering it a real candidate for analyze specifically.

**Where to check results:** `/admin/analytics` → Gemini Health → Models —
both rows will show once each model has live analyze traffic.

**Result:** ✅ closed — see the 2026-09-02 decision entry below. Full-window
Postgres data (09-01 + 09-02, 48 analyze requests): `gemini-3.5-flash-lite`
100% success / 0 timeouts / p50 3.2s / p95 9.2s vs `gemini-3.6-flash` 71.4%
success / 7 timeouts (20%) / p50 9.5s / p95 33.0s. The speed/reliability
caveat above is resolved in `gemini-3.5-flash-lite`'s favor; detection
*quality* (brand/name/sugar-estimate accuracy on analyze specifically) was
not separately scored in this A/B and remains an open question — flagged in
the decision entry below.

### 2026-09-02 — decision — Promote `gemini-3.5-flash-lite` to primary for preflight and analyze

**Decision:** end the 50/50 A/B split. `gemini-3.5-flash-lite` becomes the
primary model for both `preflight` and `analyze`; `gemini-3.6-flash` is kept
on standby as the fallback for a planned reliability-triggered failover (see
below), not deleted from the codebase.

**Why now:** the A/B ran long enough to cover both a bad external-Gemini day
(09-01) and a healthy one (09-02) — see the two Result entries above.
`gemini-3.5-flash-lite` won on every measured axis in both operations
(success rate, timeout rate, p50, p95), by a wide enough margin (e.g. 100%
vs 71.4% analyze success, 3.2s vs 9.5s analyze p50) that it isn't a
close call. It is also the cheaper model per Google's pricing, so the
switch is a win on cost as well as speed — no tradeoff to weigh here.

**Open question, not blocking this decision:** analyze detection *quality*
(does `gemini-3.5-flash-lite` identify brands/products as accurately as
`gemini-3.6-flash`, not just faster) was not isolated in this A/B — both
models ran the same prompt/schema, but nothing here scored output
correctness, only speed and provider-reported success/failure. Worth a
follow-up read once enough real analyze traffic accumulates on the new
primary, using the existing `detection_unbranded_name` diagnostic log
(`77fe250`) as one signal among others.

**Planned safety net:** `gemini-3.6-flash` remains wired in as an automatic
fallback, not removed — see the architecture note below (or a follow-up
entry once implemented) for a circuit-breaker that watches
`gemini-3.5-flash-lite`'s live success/latency and fails subsequent requests
over to `gemini-3.6-flash` if it degrades, then probes to switch back once
`gemini-3.5-flash-lite` recovers. Implementation not yet live as of this
entry — see the architecture discussion in this file's companion doc or the
relevant PR once it lands.

### 2026-09-02 — [`cc593ba`](../../commit/cc593ba) — analyze thinkingLevel raised to "medium"; sugar-estimate prompt contract clarified after a regression

**Change:** `src/lib/vision/gemini.ts` — `analyze`'s `thinkingConfig` moved
from `"low"` to `"medium"` (`thinkingConfigFor(model, "medium")`). Preflight
stays at `"minimal"`, unaffected.

**Why:** real `gemini-3.5-flash-lite` traffic on 09-02 showed the same shelf,
rescanned seconds apart, flip-flopping on whether it returned a sugar
estimate at all (and once garbling a product name, "Claro de Huevo" →
"Claro de Huerto") — consistent with `"low"` being too thin for this model
to reliably reason through brand identification + nutrition together.

**Incident along the way (self-inflicted, now fixed):** the same deploy
attempted a second change — an `estimateSource` field (`"label_or_barcode"`
vs `"typical_for_category"`) added to the response schema and prompt, meant
to stop the "scores a bottle whose label was never visible" pattern by only
trusting an estimate when Gemini claimed it read one off real packaging.
This **broke every analyze call** (`400`/`422 provider_error`, both primary
and fallback model) — Gemini rejected the request outright. Isolated via a
temporary debug log of the raw provider message
(`"Request contains an invalid argument."`) plus binary-search reverts:
neither `nullable: true` nor the `"medium"` thinking level were the cause;
declaring `estimateSource` as an `enum` *nested inside `detections[]`'s
array-item object* was. Preflight's working enum fields (`decision`,
`reasonCode`) are both top-level object properties, never nested inside an
array item — suspect that's the unsupported shape. Reverted in
[`66017ba`](../../commit/66017ba)/[`6baf487`](../../commit/6baf487): schema
field and the `toDetection` gate removed, its test skipped (not deleted).

**Second-order bug (also self-inflicted, also fixed):** the revert above
restored the *code*, but not the *prompt text* — the prompt paragraph
introduced alongside `estimateSource` was still live and told Gemini "only
set `estimatedSugarPer100g` when you can literally read a printed
value... do not estimate from recognizing the product type." Combined with
the `"medium"` bump making Gemini more literal/conservative, this drove
`estimate: 0` across *every* analyze call regardless of shelf — not a
reasoning-depth problem, a prompt regression. Fixed in
[`a3274be`](../../commit/a3274be) by restoring the prompt to its original
wording.

**The scoring contract, restated for the record (this is how it has always
worked, `gemini-3.6-flash` included — the incident above never actually
changed the intended design, just briefly broke it):**
- `estimatedSugarPer100g` is Gemini's own visual estimate, given whenever it
  successfully identifies the product — brand/name/pack-size recognition is
  enough, Gemini does **not** need to literally read a printed nutrition
  value or find a barcode match first.
- A catalog match (USDA/Open Food Facts) is an *enhancement layered on top*
  of a successful identification, upgrading `status` to `confirmed` — it is
  never a *precondition* for Gemini providing its own estimate. A product
  entirely absent from both catalogs (true for most regional/foreign brands)
  should still get a Gemini-estimated score as long as it was identified.
  `estimatedSugarPer100g` should be omitted **only** when Gemini could not
  responsibly infer a number at all — in practice, this should track
  "Gemini couldn't identify the product," not "the product isn't in a
  catalog" and not "no printed number was visible."
- Prompt wording that enforces this exactly: *"estimatedSugarPer100g is a
  visual estimate only; omit it when it cannot be responsibly inferred."*
  Any future prompt edit narrowing this (e.g. requiring a literal
  label/barcode read) is a regression against this contract, not a
  tightening — re-read this entry before changing that sentence again.

**Result:** ✅ live and confirmed — `medium` thinking level applied, prompt
contract restored and matches the design above. Verified via a direct
synthetic `POST /api/scan/analyze` call (200, no schema-shape errors) and
via real traffic in Railway logs showing `success`/`200` outcomes and
non-default confidence values (0.9–0.98, vs the previous `0.55` fallback
default) on the model's own identifications. Whether `estimate: 0` rates
actually improve for regional/unfamiliar products under the restored
contract needs a fresh log pull once more real traffic accumulates — not
yet measured post-fix.

### 2026-09-04 — pending commit — Gemini Health dashboard: missing `gemini-3.5-flash-lite` pricing, and headline cards not following the 24h/7d toggle

**Bug 1 — Estimated cost showing "—" almost always:** `estimateGeminiCost()`
(`src/lib/analytics/gemini-cost.ts`) had a single-model audited pricing
table hardcoded to `gemini-3.6-flash` only. When `gemini-3.5-flash-lite`
was promoted to primary on 2026-09-02 (see above), its pricing was never
added — so essentially all current traffic returned `estimatedCostUsd:
null`. The dashboard's "Estimated cost" card then compounded this: it
summed cost across a trailing 7-day window and *any single day with a
null cost collapsed the whole running total to null*, so the card read
"Unpriced" the moment one day in the window had no priced traffic.
**Fix:** added `gemini-3.5-flash-lite` to the pricing table ($0.30/$2.50
per 1M input/output tokens, confirmed against
[ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
on 2026-09-04) and changed the dashboard's cost aggregation
(`analytics-dashboard.tsx`) to sum only the models that have a price,
surfacing "priced models only" in the card's caption when some models in
the window are still unpriced, instead of losing the whole total.

**Bug 2 — Requests / Error rate / Provider tokens cards ignoring the 24h/7d
toggle (global and per-panel):** these three cards were sourced from
`geminiHealth.days`, a fixed trailing-7-day per-day timeline that predates
both the global toggle (this session, earlier) and the per-panel toggle
(this session, immediately before this fix) — neither ever touched it.
Only "Score yield" in that same row read from the toggle-aware
`geminiHealth.headline[range]` data, which is why it was the only card in
the row that visibly changed. **Fix:** re-sourced all four cards
(Requests, Error rate, Provider tokens, Estimated cost) from
`metricsHeadline.models` (the same per-model breakdown the Models table
below already uses), so the whole row now follows the "metrics" panel's
effective range like the rest of the toggle-aware panels.

**Also removed:** the "Historical Railway logs · Baseline and incident
comparison" panel and its backing `geminiHealth.historicalComparisons`
field/query. It held four hand-transcribed archived aggregates from the
2026-08-26–30 Railway log investigation, kept around while the persisted
`analytics_events` table was too new to have its own real history. Now
that real data spans multiple days, the archived numbers are no longer
needed as a stand-in — removed the type, the constant, the panel's JSX and
CSS, and the corresponding test assertion. `ARCHIVED_OPERATION_BASELINE`
in `analytics-dashboard.tsx` (the Day-to-day comparison table's per-day
fallback baseline) is a separate, still-used mechanism and was left alone.

**Result:** ✅ `npm run typecheck`, `npm test` (296 tests, 1 pre-existing
skip), and `npm run build` all pass. Not yet verified live in the browser
against production data.
### 2026-09-04 — [`ce2e20e`](../../commit/ce2e20e) — `estimateGeminiCost` silently dropped preflight from every cost total

**Root cause, confirmed with real production logs:** the 2026-09-04 pricing
fix above (adding `gemini-3.5-flash-lite`) didn't actually restore accurate
cost totals in production. A temporary diagnostic log
(`gemini_cost_estimate_debug`, added and removed same day) caught the exact
difference between a priced and an unpriced call:
- **Preflight** (`thinkingConfigFor(model, "minimal")`) usageMetadata:
  `{promptTokenCount: 791, candidatesTokenCount: 44, totalTokenCount: 835}`
  — **no `thoughtsTokenCount` field at all.**
- **Analyze** (`thinkingConfigFor(model, "medium")`) usageMetadata:
  `{promptTokenCount: 1272, candidatesTokenCount: 5, thoughtsTokenCount:
  149, totalTokenCount: 1426}` — priced fine, `estimatedCostUsd:
  0.0007666`.

`estimateGeminiCost` required all three directional counters
(`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`) to be
present, treating a missing one as "cannot price." At `minimal` thinking
level Gemini omits `thoughtsTokenCount` from the response entirely instead
of reporting `0` — so **every preflight call** (the majority of total
volume) silently priced out to `null`, leaving only analyze's small
per-call output cost in any total. That's why "Estimated cost" read $0.00–
$0.01 in production despite real spend being visibly higher on the Google
side.

**Fix:** `thoughtsTokenCount` is no longer required — a missing value now
defaults to `0` thinking tokens (a legitimate outcome of `minimal`
thinking, not an error). Only `promptTokenCount` and `candidatesTokenCount`
missing still returns `null`, since those two are the actual core
input/output counters a response should always carry. Added a regression
test (`gemini-cost.test.ts`) using the exact preflight payload captured
above.

**Result:** ✅ `npm run typecheck`, `npm test` (297 tests, 1 pre-existing
skip), `npm run build` all pass. Temporary diagnostic log removed in the
same change.

### 2026-09-04 — pending commit — Cloud Billing panel redesign: daily spend, month-to-date, and a manually-configured cap

**Why:** the old "Actual billed spend" card only showed 24h/30d aggregates
— no day-by-day trend, no month-to-date, no sense of "are we close to our
limit." Researched what Google actually exposes programmatically before
designing anything: confirmed against
[ai.google.dev/gemini-api/docs/billing](https://ai.google.dev/gemini-api/docs/billing)
that the AI Studio "Gemini API Spend" page's monthly spend cap and prepay
credit balance have **no public API** — UI-only. The Cloud Billing Budgets
API was also ruled out: it only returns a budget's configuration, never
live spend, and would need billing-account-level IAM beyond what this
integration already has.

**What's real vs. operator-provided, made explicit in the UI:**
- Month to date, yesterday, and the daily chart are real numbers from the
  already-connected BigQuery billing export (`cloud-billing.ts`), extended
  with a day-bucketed Gemini-only query (last 28 days) and a calendar-month
  (not rolling 30d) sum to match how Google itself frames "month to date."
- "Avg per request" divides that real 7-day Gemini spend by our own 7-day
  `vision_request` count (`geminiHealth.headline["7d"]`) — a genuine
  blended $/request figure, not the app-side token estimate.
- "Projected month end" is a simple linear extrapolation
  (month-to-date ÷ elapsed days × days in month), labeled "at current daily
  pace" so it doesn't read as a promise.
- "Your configured monthly cap" reads `GEMINI_MONTHLY_SPEND_CAP_USD`, an
  env var the operator sets to match what they configured in AI Studio —
  the panel copy says explicitly that this is manual, not fetched live,
  since Google won't give us the real number.
- Deliberately no "Today" card and no "Google account balance" card — the
  export has no freshness guarantee (commonly 1-2 days behind, sometimes
  the "stale >36h" case already in this dashboard), and a prepay balance
  has no API at all. Showing either would be fabricating data.

**Chart:** hand-rolled flat-bar chart (`DailySpendChart`, matching this
dashboard's existing no-dependency visuals rather than adding Chart.js),
with a 7d/28d toggle that just slices the already-fetched 28-day array —
no extra request.

**Result:** ✅ `npm run typecheck`, `npm test` (298 tests, 1 pre-existing
skip), `npm run build` all pass. New `cloud-billing.test.ts` coverage for
the daily-breakdown query and the manually-configured cap. Not yet
verified live against production BigQuery data.
