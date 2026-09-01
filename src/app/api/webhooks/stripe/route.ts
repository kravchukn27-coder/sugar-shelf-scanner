import { Pool } from "pg";
import { handleStripeWebhook } from "@/lib/access/stripe-webhook-handler";
import { getStripeWebhookConfig } from "@/lib/env";

export const runtime = "nodejs";

const webhookPool = globalThis as typeof globalThis & { __sugarStripeWebhookPool?: Pool };

function getWebhookPool(databaseUrl: string): Pool {
  return webhookPool.__sugarStripeWebhookPool ??= new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 1_500,
    query_timeout: 1_500,
  });
}

/**
 * Stripe's signed delivery is the payment source of truth. Browser redemption
 * remains in place as a fast path for the success screen, but a buyer no longer
 * has to return from Checkout for their payment to reach the ledger or unlock
 * a pass. Returning 5xx only means a verified event could not be stored, which
 * asks Stripe to retry safely.
 */
export async function POST(request: Request) {
  return handleStripeWebhook(request, {
    getConfig: getStripeWebhookConfig,
    getPool: getWebhookPool,
    now: () => new Date(),
  });
}
