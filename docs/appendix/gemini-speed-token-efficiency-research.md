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
| B1, B2, B3 | **Done** — commit `39ac549`, pushed to `main` | Staged `captured_analyzing` copy + soft "uncertain" hint instead of hard-failing the live search loop. `src/app/page.tsx` only. |
| C1, D2 | **Done** — pending commit | `mediaResolution: "MEDIA_RESOLUTION_LOW"` added to preflight's `generationConfig` (confirmed against the live Generative Language API discovery document — the field is real and exactly named this, not a guess); catalog DB probe (`createRuntimeCatalog`) now starts alongside the Gemini analyze call instead of after it, via a `catalog` promise param on `resolveScan`. `npx tsc --noEmit` clean, all 79 existing tests pass unchanged. |
| A1, A2, B (verified on-device), C2–C5, D1, D3, D4 | Not started | See rollout order below. |

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
| Candidate-gate threshold | 0.75 (hardcoded) | `page.tsx:108` |
| Catalog confirm threshold | 0.88 | `product-resolver.ts:7` |
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
- **C4. Re-tune the 0.75 candidate-gate threshold** (hardcoded, no tuning
  history). Sweep 0.65/0.70/0.75/0.80 against true-candidate/true-none frames.
  Expected a modest, single-digit-percent net effect — a tuning pass, not a
  big lever.
- **C5. One bounded retry on analyze transport failures** (timeout/5xx only,
  never on a negative/low-confidence result). Today zero retries exist; any
  hiccup forces a full manual re-tap.
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
- **D4. Decide the fate of the unreachable `RecoveryCamera` path** — not
  wired into any live UI (`recovery-camera.tsx`, confirmed via grep). Zero
  cost today (unreachable code makes zero requests). **Being handled by
  another agent/track — not touched here.**

## Rollout order (no target latency numbers fixed yet — set after the A1 window)

1. **A1 + A2** — instrumentation, ships before anything else.
2. **D2** — free win, no risk, can ship alongside A1/A2.
3. **D1, D3** — client-only request filters, instant rollback.
4. **B1, B2, B3** — UI-only, no latency change, only perception.
5. **C1** — cheap config check + one-line change, verified actionable above.
6. **C2, C3** — accuracy-risk changes; C2 explicitly deferred (needs a real
   fixture set), C3 needs model-access confirmation first.
7. **C4, C5** — tuning, after A1 gives real distributions.

## Open items — resolutions and deferrals from this round

- **Model name** — resolved. `gemini-3.6-flash` / `gemini-3.7-flash` are real,
  actively billed Tier 1 models (confirmed via Gemini usage dashboard), not a
  typo.
- **Code vs. Railway model config mismatch** — still open. The repo only
  defines one model default (`GEMINI_VISION_MODEL`, with `GEMINI_PREFLIGHT_MODEL`
  falling back to it since 25 Aug); the dashboard shows real split traffic
  across two models. Someone has set an override directly in Railway that
  isn't reflected in `.env.example` or code comments. Needs a direct check of
  the production environment variables — not resolvable from the repo alone.
- **`media_resolution`** — resolved. Confirmed via code read: not set
  anywhere. C1/C2 are actionable as described.
- **Stale code comment** — found in passing: `gemini.ts:288` still says
  `// Flash-Lite is used as a classifier...`, left over from the reverted
  25 Aug split. Misleading today; worth a one-line fix alongside any of the
  above.
- **Fixture-set size for vision-accuracy testing** — explicitly **deferred**.
  Not a priority for the current demo; only relevant once C2/C3 move past
  discussion.
- **Unreachable `RecoveryCamera` path (D4)** — explicitly **out of scope**
  here, owned by a separate agent/track.
