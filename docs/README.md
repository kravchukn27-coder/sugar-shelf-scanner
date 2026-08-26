# Documentation map

Read only the document relevant to the task. This keeps implementation context
small and prevents historical notes from being treated as requirements.

| Need | Document |
| --- | --- |
| Current priorities and release gates | [Active plan](/Users/nikitakravchuk/.codex/plans/01a03826-b566-7ed3-82e8-fc4a03168af9/01a0383b-9131-7492-9688-9c6c42542a7b/PLAN.md) |
| Scanner states, UI rules and recovery | [product-ux.md](product-ux.md) |
| iPhone/Safari camera decisions and regression checks | [camera.md](camera.md) |
| Reviewed SKU data, matching, PostgreSQL and contribution policy | [catalog-data.md](catalog-data.md) |
| Railway activation, deploy and observability operations | [operations.md](operations.md) |
| Temporary Gemini token measurement | [gemini-usage-observability.md](gemini-usage-observability.md) |
| Gemini speed/quality/token-efficiency research (closed) | [appendix/gemini-speed-token-efficiency-research.md](appendix/gemini-speed-token-efficiency-research.md) |
| Superseded working-plan context | [archive/2026-08-26-plan-history.md](archive/2026-08-26-plan-history.md) |

`CATALOG_REVIEW_SPAIN.md` is the human review table. The executable reviewed
seed is `src/lib/catalog/approved-spain.ts`; do not derive runtime nutrition
from prose or from Gemini.
