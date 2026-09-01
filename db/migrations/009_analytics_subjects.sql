-- A keyed digest of a random browser installation token enables DAU/WAU/MAU
-- without retaining the original token, an email address, IP address or device
-- fingerprint. Existing server-originated events intentionally remain NULL.
ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS subject_hash text
    CHECK (subject_hash IS NULL OR subject_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS analytics_events_subject_occurred_at_idx
  ON analytics_events (subject_hash, occurred_at DESC)
  WHERE subject_hash IS NOT NULL;
