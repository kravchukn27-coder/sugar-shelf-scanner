# Catalog suggestions: review-only intake

An unresolved result can enter recovery from its open Details card. The browser
locally detects a valid barcode and can only note that a nutrition label was
seen. It never uploads recovery frames or raw OCR text. If the barcode is not
already confirmed, the user may type package facts and send a suggestion.

`POST /api/catalog/proposals` stores that suggestion in `catalog_proposals`
with `status = pending_review`. It is intentionally not read by the runtime
catalog resolver, so it cannot change a scan result or self-confirm nutrition.
Only one pending proposal may exist for a barcode. A repeated submission gets a
clear “already waiting for review” response; a curator decision allows a later
corrected suggestion.

## Deployment prerequisite

Apply [`003_catalog_proposals.sql`](../db/migrations/003_catalog_proposals.sql)
to the same reviewed PostgreSQL database used by the runtime, before exposing
the submission UI in production. The route returns `503` when `DATABASE_URL`
is not configured, rather than silently retaining a suggestion elsewhere.

The application has a small per-instance guard of five submissions per hour
per forwarded client address. Railway restarts or multiple instances reset that
counter; production should add a shared rate limiter/WAF before public scale.
The client address is used only for this ephemeral guard and is not stored.

## Curator approval handoff

Review pending entries outside the runtime service:

```sql
SELECT id, barcode_gtin, proposed_brand, proposed_name, proposed_pack_size,
       sugar_per_100g, protein_per_100g, label_seen_locally, created_at
FROM catalog_proposals
WHERE status = 'pending_review'
ORDER BY created_at;
```

For each record, a curator must independently verify the package identity,
GTIN, pack size, and nutrition facts against an authoritative source or the
package. Then add the verified product and aliases to
[`src/lib/catalog/approved-spain.ts`](../src/lib/catalog/approved-spain.ts),
including provenance, and run the existing reviewed import:

```bash
npm run catalog:import
```

Finally record the human review decision; this does not import anything by
itself:

```sql
UPDATE catalog_proposals
SET status = 'approved', reviewed_at = now(), reviewer_note = 'Verified against package and source URL'
WHERE id = '<proposal uuid>';
```

Use `rejected` with a concise reason for wrong GTIN, duplicate, insufficient
evidence, or impossible nutrition. Do not copy user-entered nutrition into the
trusted catalog without the independent review step.
