import { digestEmail, issueAccessPass } from "@/lib/access/access-pass";
import { recordStripePaymentEvent } from "@/lib/access/stripe-ledger";
import type { SqlQueryExecutor } from "@/lib/catalog/repository";
import {
  isPaidCheckoutEvent,
  parseStripeWebhookEvent,
  toStripePaymentLedgerEntry,
  verifyStripeWebhookSignature,
} from "@/lib/access/stripe-webhook";
import type { StripeWebhookConfig } from "@/lib/env";

export type StripeWebhookDependencies = {
  getConfig: () => StripeWebhookConfig | null;
  getPool: (databaseUrl: string) => SqlQueryExecutor;
  now: () => Date;
};

function response(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Handles Stripe's signed delivery independently of Next.js/pg plumbing so
 * the full payment-to-pass path can be tested with a deterministic executor.
 */
export async function handleStripeWebhook(request: Request, dependencies: StripeWebhookDependencies) {
  const config = dependencies.getConfig();
  if (!config) return response(503);

  const payload = await request.text();
  if (!verifyStripeWebhookSignature(payload, request.headers.get("stripe-signature"), config.stripeWebhookSecret)) {
    return response(400);
  }

  const event = parseStripeWebhookEvent(payload);
  if (!event) return response(400);
  const entry = toStripePaymentLedgerEntry(event);
  if (!entry) return response(200);

  try {
    const pool = dependencies.getPool(config.databaseUrl);
    const emailDigest = entry.email ? digestEmail(entry.email, config.accessPassSecret) : null;
    const now = dependencies.now();
    await recordStripePaymentEvent(pool, entry, emailDigest, now);
    if (isPaidCheckoutEvent(entry)) {
      await issueAccessPass(pool, {
        checkoutSessionId: entry.checkoutSessionId,
        email: entry.email,
        secret: config.accessPassSecret,
        now,
      });
    }
    return response(200);
  } catch {
    // A verified event has not completed durable processing. Stripe retries
    // this delivery, while both ledger and pass writes remain idempotent.
    return response(503);
  }
}
