-- Paid access for the monetization test. This table holds no scan data, no
-- product data and no readable contact address: the buyer's email is stored
-- only as a keyed digest, which is enough to answer "does this address own an
-- active pass?" and nothing else. Dropping this table removes the whole
-- feature's stored state.
CREATE TABLE IF NOT EXISTS access_passes (
  token text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{48}$'),
  -- One payment yields exactly one pass, so reloading the Stripe success URL
  -- returns the existing pass instead of minting another.
  checkout_session_id text NOT NULL UNIQUE,
  email_digest text NOT NULL CHECK (email_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

-- Supports the restore-by-email lookup, newest active pass first.
CREATE INDEX IF NOT EXISTS access_passes_email_idx
  ON access_passes (email_digest, expires_at DESC);
