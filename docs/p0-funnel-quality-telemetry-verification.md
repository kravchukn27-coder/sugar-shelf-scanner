# P0 result funnel and result-quality telemetry: verification matrix

This telemetry is deliberately aggregate-only. It must be useful for the
result funnel while remaining unable to identify a person, device, scan,
product, or image. These checks apply to every new browser event and to its
single server intake endpoint.

## Required test matrix

| Area | Scenario | Expected assertion |
| --- | --- | --- |
| Browser gate | The public browser flag is absent, `false`, or malformed. | No beacon or fetch is attempted. |
| Server gate | `SCANNER_METRICS_ENABLED` is absent or not exactly `true`. | The endpoint returns `204` with `Cache-Control: no-store`, does not read/log the payload, and writes no database row. |
| Capability gate | The browser has not received the server capability header for the active scan flow. | No product-funnel/quality event is sent even if the public flag is `true`. |
| Happy path | The server flag and browser/capability gates are enabled, and an allowlisted event is reported. | One `204` response; exactly one structured log record containing the fixed event name plus the parsed allowlisted fields. |
| Schema boundary | Each unknown field, including a nested unknown field, is posted while enabled. | `400`, `Cache-Control: no-store`, and no log. |
| Privacy boundary | Post representative prohibited values: `scanId`, `sessionId`, `clientFrameId`, barcode/GTIN, product name/brand, image/base64, OCR text, error string, timestamps, IP, device ID and camera label. | Every payload is rejected and no log is emitted. The emitted happy-path object exactly equals the allowlisted payload plus its fixed `event` name. |
| Transport preference | `navigator.sendBeacon` accepts the payload. | One request to the telemetry endpoint; JSON body contains only the allowlist. No fetch fallback. |
| Transport fallback | `sendBeacon` is unavailable or returns `false`. | A `POST` `fetch` with JSON content type and `keepalive: true` is issued. |
| Transport isolation | `sendBeacon` throws, JSON/blob construction throws, or fallback fetch rejects. | The reporting function does not throw and scan/result UI state is unchanged. |
| Client idempotence | The same active scan is started repeatedly, the same result presentation is rendered repeatedly, React effects replay, or a product/recommendation is opened repeatedly. | At most one event for each currently emitted action per active scan: `scan_started`, `result_shown`, `product_opened`, and `recommendation_opened`. |
| Stale work isolation | A result callback fires after retry, close, recovery, unmount, or scan session replacement. | No event is emitted for the stale result. |
| Quality classification | Empty detections, all unknown, mixed/only estimate, and at least one confirmed result are classified. | Exactly one mutually exclusive outcome bucket is recorded for the displayed result. |
| Quality count bucket | Eligible unique product groups total `0`, `1`, `2–5`, and `6+`. | The corresponding bounded bucket is sent; no exact unbounded count or detection identifiers are sent. |
| Funnel ordering | A scan reaches a displayed result and the user opens a product or recommendation. | `result_shown` precedes the interaction event; interaction must not be emitted when no result was shown. |
| Reserved-action schema | `scan_retried` and `scan_abandoned` payloads are posted directly to the endpoint. | The endpoint accepts only the documented strict shape; `scan_abandoned` permits only `camera`, `preflight`, `analysis`, or `result`. The current browser does not emit either action. |
| Abort/no-result | Request failure, preflight terminal, explicit close, and an abandoned live view. | No `result_shown`, `product_opened`, or `recommendation_opened` event unless a result was actually shown. |

## Suggested test placement

Keep the unit tests close to the existing privacy telemetry tests:

- `src/lib/observability/result-metrics.test.ts`: strict schema, enum/bucket
  bounds, logger allowlist, and forbidden-field regression table.
- `src/app/api/scan/result-metrics/route.test.ts`: disabled silent no-op,
  malformed/oversized/unknown request rejection, and enabled logging.
- `src/lib/scan/result-metrics.test.ts`: public/capability gating,
  beacon preference, fetch fallback, and failure isolation.
- `src/lib/scan/result-analytics.test.ts`: classification and count
  buckets independently of React UI code.

The existing `node:test` tests demonstrate the intended style. Stub
`console.info`, `navigator`, and `fetch`, then restore their descriptors in a
`finally` block so telemetry tests cannot leak browser globals into unrelated
tests.

## Test-data rule

Use synthetic values such as `forbidden-product-name` and
`do-not-log-barcode` only as rejected input fixtures. Never put those values
in a successful event assertion: the successful expected object should list
only literal enum names and bounded numeric buckets. This makes the test suite
a regression guard against accidentally expanding the retention surface.

## Completion command

Run the focused new test files first, then run:

```sh
npm test
npm run typecheck
```

The test suite should verify only telemetry behavior; it must not require a
real camera, an external analytics service, a database, or a vision provider.
