# Gemini usage observability

## Purpose

For a short measurement period, determine the real Gemini token use, latency and
request count for scanner preflight and full analysis. This is a cost and
performance diagnostic, not product analytics and not a camera telemetry system.

The camera can now provide a higher-quality source frame (`1920×1440` was
observed on the tested iPhone), but the browser still sends resized JPEGs:

| Operation | Image sent to Gemini | Why |
| --- | --- | --- |
| `preflight` | 448 px wide, JPEG quality 0.55 | Decide whether a packaged product is present. |
| `analyze` | 960 px wide, JPEG quality 0.7, centred 1.12× crop after a positive preflight | Identify products and return boxes. |

The source camera resolution is therefore not itself the billed image size. The
number of preflight attempts and full analyses is the main controllable cost.

## Proposed temporary measurement

Add an opt-in server flag, `VISION_USAGE_METRICS_ENABLED=true`. When it is off,
the application must behave exactly as it does today.

When it is on, after a completed Gemini response log one structured event with
only:

```ts
{
  event: "vision_usage",
  operation: "preflight" | "analyze",
  model: string,
  durationMs: number,
  status: number,
  promptTokenCount?: number,
  candidatesTokenCount?: number,
  thoughtsTokenCount?: number,
  totalTokenCount?: number,
}
```

Read these values from Gemini's response `usageMetadata`; tolerate missing
fields because providers and model versions can differ. Do not estimate tokens
from JPEG bytes and do not alter Gemini's media-resolution setting as part of
this measurement.

Never log or store: image/base64 data, raw frames, OCR text, product names,
GTINs, prompts, Gemini output, IP address, user ID, `deviceId`, camera label,
or precise timestamps associated with a person. Existing operation/model/status
telemetry may remain, but this event must not add a correlatable scan ID.

## Operating procedure

1. Enable the flag in Railway for a fixed 14-day observation window.
2. Review aggregate daily totals only: count of `preflight` and `analyze`,
   p50/p95 duration, average/p95 input tokens, output/thinking tokens, and
   full-analysis-to-preflight ratio.
3. Calculate cost from the then-current price of the **actual Railway model**:
   `input tokens × current input rate + output/thinking tokens × current output rate`.
   Prices and token handling are model-dependent, so do not hard-code a dollar
   estimate in application code. Gemini documents image token allocation and
   media-resolution behaviour at <https://ai.google.dev/gemini-api/docs/media-resolution>.
4. After 14 days, export only the aggregate table into a decision note, turn the
   flag off, and remove the temporary per-request usage logging in a follow-up
   change unless it has a clear operational owner and retention policy.

## Decision thresholds

- Keep the current camera policy if higher effective source quality improves
  successful scans without a material change in measured token counts.
- Investigate scheduler/request frequency if preflight volume per completed scan
  is high; do not lower image quality first.
- Consider a lower media resolution only after an A/B test proves that catalog
  matching and box accuracy remain acceptable.

## Current status

Documented only. No usage metadata is logged to Railway yet, and no user image
or scan content is retained by this proposal.
