-- Canonical catalog records are deliberately provider-neutral. Open Food Facts,
-- USDA and manually verified records can all resolve to the same product row.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  canonical_brand text,
  canonical_name text NOT NULL,
  canonical_flavour text,
  canonical_pack_size text,
  normalized_search_text text NOT NULL,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_search_text_trgm_idx
  ON products USING gin (normalized_search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS product_identifiers (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (identifier_type IN ('gtin', 'upc', 'ean', 'source_id')),
  identifier_value text NOT NULL,
  source text NOT NULL CHECK (source IN ('curated', 'open_food_facts', 'usda_food_data_central', 'commercial')),
  UNIQUE (identifier_type, identifier_value, source)
);

CREATE INDEX IF NOT EXISTS product_identifiers_lookup_idx
  ON product_identifiers (identifier_type, identifier_value);

CREATE TABLE IF NOT EXISTS product_nutrition (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  sugar_per_100g numeric CHECK (sugar_per_100g >= 0),
  protein_per_100g numeric CHECK (protein_per_100g >= 0),
  serving_size_g numeric CHECK (serving_size_g > 0),
  source text NOT NULL CHECK (source IN ('curated', 'open_food_facts', 'usda_food_data_central', 'nutrition_label', 'commercial')),
  source_record_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS product_aliases (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias_type text NOT NULL CHECK (alias_type IN ('brand', 'name', 'flavour', 'full_label')),
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  UNIQUE (product_id, alias_type, normalized_alias)
);

CREATE INDEX IF NOT EXISTS product_aliases_normalized_trgm_idx
  ON product_aliases USING gin (normalized_alias gin_trgm_ops);

CREATE TABLE IF NOT EXISTS catalog_imports (
  id uuid PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('open_food_facts', 'usda_food_data_central')),
  source_version text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  imported_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  error_summary text
);

CREATE TABLE IF NOT EXISTS scan_feedback (
  id uuid PRIMARY KEY,
  scan_id text NOT NULL,
  candidate jsonb NOT NULL,
  selected_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('confirmed', 'rejected', 'corrected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
