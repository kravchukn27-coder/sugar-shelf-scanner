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
