# Catalog suggestions: review-only intake

An unresolved result can enter recovery only from its open Details card. A
proposal is created after the user reviews a package or nutrition-label draft.
It never uploads or persists recovery frames or raw OCR text.

`POST /api/catalog/proposals` stores that suggestion in `catalog_proposals`
with `status = pending_review`. It is intentionally not read by the runtime
catalog resolver, so it cannot change a scan result or self-confirm nutrition.
Only one pending proposal may exist for a barcode. A label-first proposal may
omit the barcode, in which case a server-derived digest of normalised
brand/name/pack size controls duplicate intake. This is only review-queue
dedupe—not a product match—and a curator may attach a GTIN later. A repeated
submission gets a clear “already waiting for review” response; a curator
decision allows a later corrected suggestion.

The safe proposal payload contains the user-confirmed identity and pack, nullable
per-100g fields for energy (kcal), protein, fat, carbohydrates and sugars, plus
optional numeric field-confidence metadata. A Gemini-extracted label must be
explicitly consented (`intakeProvenance = gemini_label` and
`labelCaptureConsented = true`). The proposal contract strictly rejects extra
properties, so images, base64, raw OCR, prompts, provider output, device data
and IP cannot enter through this endpoint.

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
       energy_kcal_per_100g, protein_per_100g, fat_per_100g,
       carbohydrates_per_100g, sugar_per_100g, intake_provenance,
       label_capture_consented, nutrition_field_confidence, created_at
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

## Demo-mode exception — planned, not the production policy

The planned recovery demonstration may show a user-confirmed barcode or
nutrition-label draft as immediately accepted in that user's current demo
session after they press **OK**. This is presentation behaviour for the demo;
it is not evidence that the package data is verified and it must not redefine
the permanent catalog governance rule.

Before a production catalog row can be marked `confirmed`, a curator must
manually verify the product identity, GTIN (when present), pack size and all
five nutrition values against the physical package and/or an authoritative source.
The curator then records the decision and imports the verified values with
provenance. The production implementation must make the distinction explicit:
demo acceptance is provisional, while the durable source of `confirmed` facts
is human-reviewed catalog import.
