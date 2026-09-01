-- Stripe is the source of truth for completed, delayed, and refunded payments.
-- Keep only the compact facts the product dashboard needs; raw webhook bodies
-- can contain billing details and are deliberately not stored here.
CREATE TABLE IF NOT EXISTS stripe_payment_ledger (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  event_created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  checkout_session_id text,
  payment_intent_id text,
  customer_id text,
  payment_status text,
  amount_total integer,
  amount_refunded integer,
  currency text,
  customer_email_digest text
);

CREATE INDEX IF NOT EXISTS stripe_payment_ledger_event_created_at_idx
  ON stripe_payment_ledger (event_created_at DESC);
CREATE INDEX IF NOT EXISTS stripe_payment_ledger_checkout_session_id_idx
  ON stripe_payment_ledger (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stripe_payment_ledger_payment_intent_id_idx
  ON stripe_payment_ledger (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
