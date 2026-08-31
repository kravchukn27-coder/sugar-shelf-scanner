import { Pool } from "pg";
import { z } from "zod";
import { issueAccessPass } from "@/lib/access/access-pass";
import { verifyCheckoutSession } from "@/lib/access/stripe-checkout";
import { getAccessPassConfig } from "@/lib/env";
import { checkScanRateLimit, logAccessRequest } from "@/lib/observability/scan-route";

export const runtime = "nodejs";

const bodySchema = z.object({ checkoutSessionId: z.string().min(1).max(120) }).strict();

const accessPool = globalThis as typeof globalThis & { __sugarAccessPool?: Pool };

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

// Bounded like every other pool here: two low-traffic routes share this one, and
// a hung database must surface as the documented 503 rather than a hanging route.
function getAccessPool(databaseUrl: string): Pool {
  return accessPool.__sugarAccessPool ??= new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 1_500,
    query_timeout: 1_500,
  });
}

/**
 * Exchanges a completed Stripe checkout session for an access pass.
 *
 * There is no webhook: the buyer's return from the Payment Link is the trigger,
 * and Stripe itself is asked whether that session was actually paid. Issuing is
 * idempotent, so reloading the success URL returns the same pass.
 */
export async function POST(request: Request) {
  const startedAt = performance.now();
  const respond = (body: unknown, status: number, headers: Record<string, string> = {}) => {
    logAccessRequest("access_redeem", startedAt, status);
    return json(body, status, headers);
  };

  const config = getAccessPassConfig();
  if (!config) return respond({ error: "unavailable" }, 503);

  // Ahead of the Stripe call on purpose: a loop of junk session ids would
  // otherwise rate limit the Stripe account and break redemption for buyers.
  const rateLimit = checkScanRateLimit(request, {
    scope: "access_redeem",
    limit: 10,
    windowMs: 60_000,
    secret: process.env.RATE_LIMIT_SECRET,
  });
  if (!rateLimit.allowed) {
    return respond({ error: "rate_limited" }, 429, { "Retry-After": String(rateLimit.retryAfterSeconds) });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ error: "invalid_request" }, 400);

  const verification = await verifyCheckoutSession(parsed.data.checkoutSessionId, config.stripeSecretKey);
  if (verification.status === "invalid") return respond({ error: "invalid_request" }, 400);
  if (verification.status === "unavailable") return respond({ error: "unavailable" }, 503);
  if (verification.status === "unpaid") return respond({ error: "not_paid" }, 402);

  try {
    const pool = getAccessPool(config.databaseUrl);
    const pass = await issueAccessPass(pool, {
      checkoutSessionId: parsed.data.checkoutSessionId,
      email: verification.email,
      secret: config.accessPassSecret,
      now: new Date(),
    });
    return respond(pass, 200);
  } catch {
    // The payment succeeded even though we could not store the pass. Say
    // nothing about the database; the buyer can restore by email once it is up.
    return respond({ error: "unavailable" }, 503);
  }
}
