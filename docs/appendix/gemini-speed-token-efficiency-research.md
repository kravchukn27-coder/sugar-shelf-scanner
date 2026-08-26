# Gemini speed, recognition quality and token-efficiency research

**Status: closed.** Research phase for the corresponding `PLAN.md` item is done;
implementation of individual hypotheses (H-A1 … H-D4) is tracked separately,
outside this document.

**Full formatted report (artifact):**
<https://claude.ai/code/artifact/2c9a8eaa-0343-4c25-a97c-044c7116971d>

This file is a plain-text mirror of that report for git history and search.
The artifact is the primary version; update it first, then re-sync this file.

## Implementation status

| Item | Status | Notes |
| --- | --- | --- |
| A1, A2 | **Done** — commits `6bc3353`, `85cf1b7`, extended `a19ec12` | Opt-in scanner stage metrics (`SCANNER_METRICS_ENABLED`) plus preflight-attempt counting; `a19ec12` added `queueMs` to `vision_request` to separate route-entry queueing from the Gemini call itself. |
| B1, B2, B3 | **Done** — commit `39ac549`, pushed to `main` | Staged `captured_analyzing` copy + soft "uncertain" hint instead of hard-failing the live search loop. `src/app/page.tsx` only. |
| C1 | **Reverted** — commit `875aa66` | `mediaResolution: "MEDIA_RESOLUTION_LOW"` (shipped in `0be75b3`) was removed from preflight after it regressed recognition of small packaged products; preflight now uses Gemini's default media resolution again. Closed — do not retry without a fixture-set regression test. |
| D2 | **Done** — commit `0be75b3` | The catalog DB probe starts alongside Gemini analysis instead of after it (`analyze/route.ts`). Shipped together with C1 in the same commit; unaffected by C1's revert. |
| C5 (revised) | **Done** — commit `e4274bd`, pushed to `main` | Original scope (retry with the same 30s timeout) was rejected: worst case would have gone from 30s to 60s of silent wait, against the spirit of section B. Shipped instead: one bounded retry on `analyze`, only for `provider_timeout` or a `provider_error` with a 5xx status — never for a parsed-but-invalid response or a client-side config error — using a separate, shorter 8s timeout for the retry attempt (worst case now ~38s, not 60s). `src/lib/vision/gemini.ts` only. `npx tsc --noEmit` clean, all 79 existing tests pass. No automated test covers the retry path itself — `gemini.ts` has no test file at all, and standing one up (mocking `fetch`/`AbortController` timing) was judged out of scope for a "cheap" task; flagging this as a real coverage gap rather than a solved item. |
| D4 | **Done** — commit `4e4720e`, pushed to `main` | The former unreachable recovery path was replaced by the one-shot Details-only recovery camera. It has no live Gemini scheduler and no default scanner barcode control. |
| C2, C3, C4 | Not started | C2/C3 explicitly deferred pending a larger fixture set / confirmed model access; C4 remains a later tuning pass. |
| D1 | **Done** — commit `047b50d` | Live preflight is skipped while the downscaled frame is moving. |
| D3 | **Implemented locally** | Live-only client blur/brightness/exposure gate with a bounded three-skip fallback, aggregate `qualitySkipped` metric, and `NEXT_PUBLIC_FRAME_QUALITY_ENABLED` rollback flag. Requires iPhone fixture calibration before treating thresholds as final. |

## Method

Four parallel code audits (pipeline latency, perceived-speed UX, recognition
strategy, request elimination) plus a check of current Gemini `media-resolution`
and pricing docs. Findings were then cross-checked against the Gemini API
usage dashboard (Railway project `sugar-shelf-scanner`, Tier 1) and against
git history of `src/lib/env.ts`.

## Baseline (from code, 26 Aug 2026)

| Constant | Value | Source |
| --- | --- | --- |
| Camera poll interval | 650 ms | `page.tsx:20,210` |
| Preflight frame | 448px · JPEG q0.55 | `page.tsx:100` |
| Analyze frame | 960px · JPEG q0.7 · 1.12× centred crop | `page.tsx:73`, `frame-crop.ts:89-121` |
| Preflight timeout | 8 s | `gemini.ts:11` |
| Analyze timeout | 30 s | `gemini.ts:10` |
| Candidate-gate threshold | 0.65 | `page.tsx` |
| Catalog confirm threshold | 0.85 | `product-resolver.ts:7` |
| Retry policy | none, either stage | `gemini.ts:248-261,325-338` |
| Analyze model default | `gemini-3.6-flash` — confirmed real via usage dashboard | `env.ts:6` |
| Preflight model default | falls back to analyze model since 25 Aug 15:30 | `env.ts:9,27` |
| Frame dedup | none (pure timer + in-flight guard) | `page.tsx:99,210` |
| Token/latency-stage telemetry | not implemented | `docs/gemini-usage-observability.md` |
| DB probe vs. Gemini call | sequential, though independent | `route.ts:46-53` |
| Rate limits | ~10 RPM / ~12.89K TPM peak vs. 1000 RPM / 2M TPM Tier 1 cap — not a bottleneck | Gemini usage dashboard |

## A — Decompose latency by stage

- **A1.** Add stage-scoped timing (capture-ready, preflight RTT, analyze RTT,
  DB probe, catalog resolution, render), extending the existing
  `Server-Timing` / `vision_request` telemetry. Prerequisite for everything
  else — no direct speedup on its own.
  *Verify:* 14-day `VISION_USAGE_METRICS_ENABLED` window, cross-check with
  manual stopwatch trials on real devices.
- **A2.** Count preflight attempts per completed scan (currently unmeasured).
  Determines whether perceived slowness comes from the discovery-phase loop
  or from the single analyze call.
  *Verify:* client-side aggregate-only counter per scan.

## B — Perceived speed

- **B1.** Two-phase copy during `captured_analyzing` ("Identifying
  package…" → "Checking catalog…"), driven by the already-measured
  `visionMs`/`catalogMs` boundary. UI-only, no real latency change.
  *Verify:* A/B on copy, close-rate during `captured_analyzing` before/after.
- **B2.** "Still working…" reassurance after ~6-8 s of analyze (timeout is
  30 s with total silence today). Targets tail abandonment, not the median.
  *Verify:* retry/close rate segmented by real duration bucket.
- **B3.** Use preflight's unused confidence range (0.4-0.75) for a soft "getting
  closer" hint instead of silence during `live_searching`.
  *Verify:* time-to-first-useful-signal; small moderated test.

## C — Recognition strategy (crop / resolution / prompt / model / gate)

- **C1. Set `media_resolution=low` for preflight — confirmed actionable.**
  Checked `gemini.ts:287-301`: the parameter is not set anywhere today, so
  Gemini runs on the "unspecified" tier, which Google's own docs say "varies
  significantly." Preflight is the highest-volume call in the system, so this
  is the single largest likely token lever. One-line change, no migration risk.
  *Verify:* `usageMetadata` token comparison after A1, candidate/none accuracy
  unchanged on the fixture set.
- **C2. Try `medium` for analyze.** Google states PDF/dense-text quality
  "typically saturates at medium" (560 vs. 1120 tokens). Real accuracy risk on
  small brand/pack text — the one hypothesis where savings and risk are both
  real.
  *Verify:* fixture-set confirm/estimate/unknown + false-confirm rate; blocks
  release on regression. **Deferred** — needs a larger real-photo fixture set
  than currently exists (see Open items), not a priority for the current demo.
- **C3. Separate preflight model — already tried and reverted, root-caused.**
  Git history of `env.ts`, 25 Aug: 13:07 default `gemini-2.5-flash` → 15:12
  added `GEMINI_PREFLIGHT_MODEL=gemini-2.5-flash-lite` (deliberate split) →
  15:30 reverted to optional/fallback, `.env.example:8` comment: "avoids a
  model-access mismatch" → 15:39 bumped default to `gemini-3.6-flash`. This
  lines up with the ~130-error / ~90×`404 NotFound` spike seen on the Gemini
  usage dashboard that same day — consistent with the lite model being
  inaccessible for the project/key, not a code bug.
  *Verify:* confirm model access in the Gemini console/API key before retrying
  the env split; then the same fixture-set accuracy check as C2.
- **C4. Re-tune the 0.65 candidate-gate threshold** (hardcoded, no tuning
  history). Sweep 0.65/0.70/0.75/0.80 against true-candidate/true-none frames.
  Expected a modest, single-digit-percent net effect — a tuning pass, not a
  big lever.
- **C5. One bounded retry on analyze transport failures — shipped, revised
  scope.** Original idea (retry with the same 30s timeout) was rejected
  before implementation: worst case would go from 30s to 60s of silent
  wait, undermining section B. Shipped instead: retry only on
  `provider_timeout` or a 5xx `provider_error` — never on a parsed-but-invalid
  response or a client config error — with its own shorter 8s timeout, so
  worst case is ~38s, not 60s. `gemini.ts` has no test file; the retry path
  itself is unverified by automated tests.
  *Verify:* `ANALYZE_FAILURE` cause breakdown before/after via existing
  `vision_request` telemetry.

## D — Eliminate unnecessary requests

- **D1. Skip preflight while the frame is still moving.** Today literally
  every 650 ms tick fires unless already in-flight — no motion/stillness
  check exists (`page.tsx:99`). Likely the single highest-volume lever in the
  whole pipeline, since preflight already fires far more often than any other
  call.
  *Verify:* A2 counter before/after, must not regress median time-to-candidate.
- **D2. Parallelize the catalog DB probe with the Gemini analyze call**
  (`route.ts:46-53` — currently sequential though independent). Free win, zero
  accuracy risk — ship regardless of other findings.
  *Verify:* `Server-Timing` wall-time comparison on that block.
- **D3. Cheap client-side blur/brightness pre-check** before sending a frame
  to preflight — no ML, just a heuristic on the downscaled canvas. Overlaps
  D1 mechanically but targets image quality, not motion.
- **D4. Done — replace the unreachable recovery path.** The Details-only
  one-shot recovery camera shipped in `4e4720e`; it captures only after a user
  tap, uses a local barcode decoder first, and never joins the live scheduler.

## Rollout order (no target latency numbers fixed yet — set after the A1 window)

1. **A1 + A2** — instrumentation, ships before anything else.
2. **D2** — free win, no risk, can ship alongside A1/A2.
3. **D1, D3** — client-only request filters, instant rollback.
4. **B1, B2, B3** — UI-only, no latency change, only perception.
5. **C1** — cheap config check + one-line change, verified actionable above.
6. **C2, C3** — accuracy-risk changes; C2 explicitly deferred (needs a real
   fixture set), C3 needs model-access confirmation first.
7. **C4, C5** — tuning, after A1 gives real distributions.

## A1/A2 execution plan

**Scope.** Add a 14-day, explicitly enabled measurement window. It must not
alter scanner decisions, issue Gemini calls, persist data in PostgreSQL, or
correlate a person or device across scans.

### 1. Define the measurement contract first

- Keep the existing server `scan`, `vision` and `catalog` timings compatible;
  add `db_probe` and `catalog_resolution` to analyze `Server-Timing` when
  available. `db_probe` measures `createRuntimeCatalog` from launch to
  ready/fallback; `catalog_resolution` measures matching after the provider is
  ready. They run in parallel with vision and must never be summed as wall time.
- The browser holds only an in-memory run context. It records rounded/bucketed
  `captureReadyMs`, `captureEncodeMs`, preflight/analyze RTT, `renderMs`, and
  `preflightAttempts`. No timestamp, scan/frame/session ID, image metadata,
  product data, GTIN, device/camera information or error text may enter it.
- Emit at most one `scanner_completed` event for a non-aborted terminal run,
  with `completion` equal to `analysis_completed`, `preflight_terminal`, or
  `request_failure`. Dashboards must show these buckets separately; this avoids
  treating discovery failures as zero-attempt successes. Close, permission
  failure, page unload, stale session and recovery emit nothing.

### 2. Implement opt-in, schema-restricted telemetry

- Add server and browser flags, both defaulting to off. A stale browser bundle
  must still receive `204` and no log when the server flag is off.
- Add a strict `/api/scan/metrics` contract accepting only finite, capped,
  bucketed aggregate values and the bounded completion enum. It must reject
  unknown fields, set `Cache-Control: no-store`, write no database row and log
  only the allowlisted aggregate event.
- In `page.tsx`, reset the context on Start/upload/Retry; increment the attempt
  counter immediately before each dispatched preflight request. Send the one
  final summary through `sendBeacon` with `fetch(..., { keepalive: true })`
  fallback, after result paint or terminal state. Telemetry never blocks UI.
- Keep Gemini `usageMetadata` logging under the existing
  `VISION_USAGE_METRICS_ENABLED` flag. Token counters come only from Gemini,
  never from JPEG byte size.

### 3. Verify before production enablement

- Unit-test timing normalization, bucket/cap boundaries, single emission,
  abort/retry reset and the payload allowlist. Route tests cover disabled
  no-op, strict rejection and safe logging. Analyze-route tests prove parallel
  DB-probe timing without changing catalog fallback.
- Run `npm test`, `npm run verify`, typecheck and `git diff --check`.
- On iPhone Safari and upload: verify no extra request while disabled; when
  enabled, inspect that at most one small aggregate payload follows each
  non-aborted terminal run and no image/OCR/identity appears in it.

### 4. Operate and remove

- Deploy with both flags off. Enable for exactly 14 days only after confirming
  Railway log retention and access controls.
- Review daily aggregates only: counts by completion, p50/p95 stage timing,
  p50/p95 preflight attempts, Gemini usage counters and the ratio of attempts
  to completed runs. Beacon loss means browser summaries are a lower bound.
- Immediately disable both flags for a forbidden field, telemetry endpoint
  errors above 0.5%, duplicate summaries above 5%, any additional Gemini
  request, or an iPhone/time-to-result regression. At day 14 keep only the
  aggregate decision table and remove temporary event logging unless it gains
  an owner and retention policy.

## Open items — resolutions and deferrals from this round

- **Model name** — resolved. `gemini-3.6-flash` / `gemini-3.7-flash` are real,
  actively billed Tier 1 models (confirmed via Gemini usage dashboard), not a
  typo.
- **Code vs. Railway model config mismatch** — resolved. Checked the
  production service directly via `railway variables`: only
  `GEMINI_VISION_MODEL=gemini-3.6-flash` is set, `GEMINI_PREFLIGHT_MODEL` is
  absent, matching the code's fallback. No split-model traffic today; the
  original dashboard observation was from the 25 Aug `flash-lite` window
  (see C3), not a standing mismatch.
- **`media_resolution`** — superseded by C1. It was set to
  `MEDIA_RESOLUTION_LOW` for preflight in `0be75b3`, then reverted in
  `875aa66` after it regressed recognition of small packaged products.
  Preflight is back on Gemini's unspecified default.
- **Stale code comment** — resolved. The `gemini.ts:288`
  `// Flash-Lite is used as a classifier...` comment no longer exists; the
  code at that location now reads `// Cheap semantic gate for live camera
  previews...`, which is accurate.
- **Fixture-set size for vision-accuracy testing** — explicitly **deferred**.
  Not a priority for the current demo; only relevant once C2/C3 move past
  discussion.
- **Recovery camera path (D4)** — resolved in `4e4720e`; keep its one-shot
  request boundary covered by the recovery QA suite.
