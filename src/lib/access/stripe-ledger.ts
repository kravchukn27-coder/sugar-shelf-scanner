import type { SqlQueryExecutor } from "@/lib/catalog/repository";
import type { StripePaymentLedgerEntry } from "./stripe-webhook";

/**
 * Keeps one compact, immutable fact row per Stripe event. Stripe retries
 * deliveries, therefore the event id is the idempotency key rather than the
 * checkout session (which can legitimately produce several lifecycle events).
 */
export async function recordStripePaymentEvent(
  db: SqlQueryExecutor,
  entry: StripePaymentLedgerEntry,
  emailDigest: string | null,
  receivedAt: Date = new Date(),
): Promise<void> {
  await db.query(
    `INSERT INTO stripe_payment_ledger (
      stripe_event_id, event_type, event_created_at, received_at,
      checkout_session_id, payment_intent_id, customer_id, payment_status,
      amount_total, amount_refunded, currency, customer_email_digest
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (stripe_event_id) DO NOTHING`,
    [
      entry.stripeEventId,
      entry.eventType,
      entry.eventCreatedAt,
      receivedAt.toISOString(),
      entry.checkoutSessionId,
      entry.paymentIntentId,
      entry.customerId,
      entry.paymentStatus,
      entry.amountTotal,
      entry.amountRefunded,
      entry.currency,
      emailDigest,
    ],
  );
}
