# Documentation map

Read the document relevant to the task. This keeps implementation context small
and prevents historical notes from being treated as current requirements.
For a local demo quickstart, current scope, and privacy caveats, start at the
[repository README](../README.md).

| Need | Document |
| --- | --- |
| First-visit intro, scanner states, UI rules and recovery | [product-ux.md](product-ux.md) |
| iPhone/Safari camera decisions, permission failures and regression checks | [camera.md](camera.md) |
| Reviewed SKU data, matching, PostgreSQL and contribution policy | [catalog-data.md](catalog-data.md) |
| Review-pending catalog proposal handling | [catalog-proposals.md](catalog-proposals.md) |
| Paywall hypothesis, success thresholds and access mechanics | [monetization-test.md](monetization-test.md) |
| Railway activation, deploy and observability operations | [operations.md](operations.md) |
| Branch flow, release approval, staging verification and rollback | [release-workflow.md](release-workflow.md) |
| Scanner timings, Gemini request logs, token measurement, and telemetry privacy boundary | [gemini-usage-observability.md](gemini-usage-observability.md) |
| P0 result-funnel and result-quality telemetry verification | [p0-funnel-quality-telemetry-verification.md](p0-funnel-quality-telemetry-verification.md) |
| Gemini speed/quality/token-efficiency research (closed) | [appendix/gemini-speed-token-efficiency-research.md](appendix/gemini-speed-token-efficiency-research.md) |
| Superseded working-plan context | [archive/2026-08-26-plan-history.md](archive/2026-08-26-plan-history.md) |

`CATALOG_REVIEW_SPAIN.md` is the human review table. The executable reviewed
seed is `src/lib/catalog/approved-spain.ts`; do not derive runtime nutrition
from prose or from Gemini. The repository also includes deterministic mock scan
fixtures for local development and demo presentation; they are not catalog
evidence.
