-- User submissions are an isolated review queue. Nothing in this table is
-- read by the runtime resolver, so a submission cannot self-confirm a SKU.
-- Do not add raw frame data or browser OCR text here.
CREATE TABLE IF NOT EXISTS catalog_proposals (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  barcode_gtin text NOT NULL CHECK (barcode_gtin ~ '^([0-9]{8}|[0-9]{12,14})$'),
  proposed_brand text NOT NULL,
  proposed_name text NOT NULL,
  proposed_pack_size text,
  sugar_per_100g numeric CHECK (sugar_per_100g >= 0 AND sugar_per_100g <= 100),
  protein_per_100g numeric CHECK (protein_per_100g >= 0 AND protein_per_100g <= 100),
  label_seen_locally boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewer_note text,
  CHECK (reviewed_at IS NULL OR status <> 'pending_review')
);

CREATE INDEX IF NOT EXISTS catalog_proposals_pending_idx
  ON catalog_proposals (created_at) WHERE status = 'pending_review';

-- A product can have at most one unresolved community suggestion at a time.
-- Once a curator decides it, a corrected re-submission is allowed again.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_proposals_one_pending_gtin_idx
  ON catalog_proposals (barcode_gtin) WHERE status = 'pending_review';
