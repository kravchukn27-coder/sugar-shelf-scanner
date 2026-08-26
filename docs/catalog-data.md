# Catalog data and confirmation policy

## Source of truth and strictness

`CATALOG_REVIEW_SPAIN.md` is the review table for the first Spain batch;
`src/lib/catalog/approved-spain.ts` is its executable, reviewed input. The
curated seed includes the approved Spain records plus legacy demo items.

A `confirmed` response requires a precise catalog record with valid reviewed
nutrition. Gemini supplies visual identity fields only; it never supplies
nutrition for a confirmed result. Brand-only recognition, a wrong variant or a
different pack size must yield `estimate`/`unknown`, not confirmation.

Matching normalises Spanish accents and equivalent `33 cl`/`330 ml` pack sizes,
while preserving variant/size strictness. Open Food Facts or USDA errors are
availability failures, never “SKU not found”.

## Runtime catalog chain

After activation, runtime order is:

```text
reviewed PostgreSQL → reviewed curated seed → bounded OFF/USDA fallback
```

The PostgreSQL layer is selected only when it contains imported reviewed
provenance. `DATABASE_URL` alone does not activate it. An unavailable/empty DB
falls through without producing a false confirmed result.

Migration `001_catalog_foundation.sql` defines core products, aliases,
identifiers, nutrition and feedback tables. Migration
`002_reviewed_catalog.sql` adds the reviewed import schema: `identifiers`,
`provenance`, and `nutrition_facts`. The importer is idempotent and uses stable
UUIDs: `npm run catalog:import` imports only `approved-spain.ts`, not Markdown.

Migration `005_reviewed_nutrition_profile.sql` extends `nutrition_facts` with
nullable `energy_kcal_per_100g`, `fat_per_100g` and `carbohydrates_per_100g`,
alongside the existing sugar and protein columns. Sugar remains the only value
that has always been mandatory for a `confirmed` result; the three added
fields are optional supporting facts, and a `null` renders as “Not confirmed”
in product Details rather than as zero. As of this migration, all 19 currently
approved Spain SKUs have these three fields as `null` — they have not yet been
curator-verified against the package or an authoritative source. Populating
them is a separate curator task, not something Gemini/AI may infer.

## Production activation checklist

**Status: completed on 26 August 2026.** Production health reports `ready`
with 19 imported reviewed products. Keep the steps below as the recovery/runbook
for a new environment or a restored database.

1. Confirm the exact production PostgreSQL target and backup policy.
2. Apply `001` (if absent), then `002_reviewed_catalog.sql`.
3. Run `DATABASE_URL=<production URL> npm run catalog:import` from an approved
   release environment.
4. Verify reviewed provenance, aliases, GTIN identifiers and nutrition rows.
5. Test Corona Extra 330 ml, Schweppes Tónica Original and La Lechera; test a
   wrong size/variant and a provider outage fallback.

## Barcode and nutrition recovery

Recovery is contextual, not a default scanner mode. The browser decodes an
EAN/UPC locally where supported and sends only a validated 8/12–14 digit GTIN
to the recovery endpoint. That endpoint resolves it through the same catalog
chain and does not call Gemini. Nutrition-label text is a local best-effort
signal; it is neither saved nor sent today.

## User-assisted additions: implemented review-pending intake

The implemented “add data from the user” feature is a reviewed contribution
loop, never direct catalog mutation. It appears only after the user opens
Details, locally decodes a valid barcode, and that barcode remains unresolved.
Choosing **Send for review** is the explicit submission action.

1. The browser keeps recovery frames and OCR text local. The submitted payload
   is a validated GTIN, user-typed brand/name/pack size, optional user-typed
   sugar/protein per 100g, and whether a label was seen locally. It contains no
   image, OCR text, account identity, precise location, device ID or stored IP.
2. The API validates GTIN checksum and nutrition bounds, applies a bounded
   per-instance guard, and stores a `pending_review` row only. A duplicate
   pending GTIN is rejected rather than creating another review item.
3. `catalog_proposals` is never read by matching or barcode lookup, so neither
   a suggestion nor its nutrition can make a SKU `confirmed`.
4. A curator independently verifies the package and authoritative source,
   records approval/rejection, then adds only verified facts to the reviewed
   import contract. The precise handoff is in
   [catalog-proposals.md](catalog-proposals.md).

### Operational limits before public scale

The current form is appropriate for a controlled pilot, but not a completed
public contribution programme. `catalog_proposals` has no automatic retention,
deletion/export workflow or reviewer identity/audit trail beyond its decision
fields; the operator must set those before public launch. The current rate
limit is process-local and must be replaced or supplemented with a shared
Railway-compatible limiter/WAF before multiple-instance public traffic. No
automatic promotion from Gemini, barcode or OCR is permitted.

The moderation procedure lives in [catalog-proposals.md](catalog-proposals.md).
It is a companion runbook, not a new runtime source of truth.
