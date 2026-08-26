-- Recovery-label proposals remain a review queue, never a runtime catalog.
-- This migration is additive because 003_catalog_proposals.sql is already live.
-- Do not add a frame, OCR transcript, device identifier, IP address, or Gemini
-- prompt/output to this table.
ALTER TABLE catalog_proposals
  ALTER COLUMN barcode_gtin DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS identity_dedupe_key text,
  ADD COLUMN IF NOT EXISTS energy_kcal_per_100g numeric CHECK (energy_kcal_per_100g >= 0 AND energy_kcal_per_100g <= 2000),
  ADD COLUMN IF NOT EXISTS fat_per_100g numeric CHECK (fat_per_100g >= 0 AND fat_per_100g <= 100),
  ADD COLUMN IF NOT EXISTS carbohydrates_per_100g numeric CHECK (carbohydrates_per_100g >= 0 AND carbohydrates_per_100g <= 100),
  ADD COLUMN IF NOT EXISTS intake_provenance text NOT NULL DEFAULT 'user_entered'
    CHECK (intake_provenance IN ('user_entered', 'gemini_label')),
  ADD COLUMN IF NOT EXISTS label_capture_consented boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nutrition_field_confidence jsonb
    CHECK (nutrition_field_confidence IS NULL OR jsonb_typeof(nutrition_field_confidence) = 'object');

-- Existing GTIN proposals receive a deterministic key before it becomes
-- mandatory. The digest avoids making a second searchable copy of identity
-- text while allowing bounded duplicate control for label-first proposals.
UPDATE catalog_proposals
SET identity_dedupe_key = encode(digest(lower(concat_ws('|', proposed_brand, proposed_name, coalesce(proposed_pack_size, ''))), 'sha256'), 'hex')
WHERE identity_dedupe_key IS NULL;

ALTER TABLE catalog_proposals
  ALTER COLUMN identity_dedupe_key SET NOT NULL,
  ADD CONSTRAINT catalog_proposals_gemini_requires_consent
    CHECK (intake_provenance <> 'gemini_label' OR label_capture_consented = true);

-- GTIN continues to take precedence where available. A label-first submission
-- is instead deduplicated by a normalised, server-derived identity digest.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_proposals_one_pending_identity_idx
  ON catalog_proposals (identity_dedupe_key)
  WHERE status = 'pending_review' AND barcode_gtin IS NULL;
