# Plan-history index — 26 August 2026

This archive replaces a 400+ line mixed working plan. It is deliberately a
historical summary rather than a source of requirements; current decisions
belong in the focused documents under `docs/` and the repository README.

## Completed foundations

- Railway Next.js/PWA scanner, Gemini server adapter, candidate-gated capture,
  frozen frame, overlays, details sheet, deduplication, upload parity and safe
  local camera diagnostics.
- Spain review table and approved seed: Corona Extra, Schweppes variants,
  Coca-Cola, Fanta, Nestea, Sunny Delight, La Casera and La Lechera. Strict
  matching covers accents, `cerveza`, `tónica` and `33 cl`/`330 ml`.
- PostgreSQL foundation: migration `002_reviewed_catalog.sql`, idempotent
  importer, provenance and runtime order DB → curated → OFF/USDA.
- Recovery-only barcode/nutrition flow: no default barcode control; browser
  decoder stays local and recovery submits only validated GTIN.
- iPhone camera correction: quality preference produced 1920×1440 in the
  tested browser; default remains 1×, optional 2× is digital.

## Superseded or deferred items

- Do not use wider 0.5× as default and do not describe web zoom as physical
  iPhone lens selection.
- Do not trust OFF/USDA outages as product absence.
- US 50-SKU benchmark awaits reliable upstream availability/API access.
- Commercial catalog providers, visual embeddings and native AVFoundation are
  future research, not current release requirements.

For exact implementation history, use Git commits; for approved data, use
`CATALOG_REVIEW_SPAIN.md` and code-locked seed records.
