-- 001_catalog_foundation.sql is already deployable, so this migration adds the
-- review-import contract without changing or dropping its original tables.
-- The plural names are intentionally the public import schema.
CREATE TABLE IF NOT EXISTS identifiers (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('gtin', 'upc', 'ean', 'source_id')),
  value text NOT NULL,
  UNIQUE (type, value)
);

CREATE INDEX IF NOT EXISTS identifiers_lookup_idx ON identifiers (type, value);

CREATE TABLE IF NOT EXISTS provenance (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('curated', 'open_food_facts', 'usda_food_data_central', 'commercial')),
  source_record_id text NOT NULL,
  source_url text,
  observed_at timestamptz NOT NULL,
  verified_at timestamptz,
  UNIQUE (product_id, source, source_record_id)
);

CREATE TABLE IF NOT EXISTS nutrition_facts (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  sugar_per_100g numeric CHECK (sugar_per_100g >= 0),
  protein_per_100g numeric CHECK (protein_per_100g >= 0),
  provenance_id uuid NOT NULL REFERENCES provenance(id) ON DELETE RESTRICT
);

-- A reviewed import is considered active only when it has at least one
-- curated provenance row. Runtime checks this before selecting PostgreSQL.
CREATE INDEX IF NOT EXISTS provenance_curated_idx ON provenance (source, product_id);
