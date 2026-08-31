import { Pool } from "pg";
import { z } from "zod";
import { issueAccessPass } from "@/lib/access/access-pass";
import { verifyCheckoutSession } from "@/lib/access/stripe-checkout";
import { getAccessPassConfig } from "@/lib/env";

export const runtime = "nodejs";

const bodySchema = z.object({ checkoutSessionId: z.string().min(1).max(120) }).strict();

const accessPool = globalThis as typeof globalThis & { __sugarAccessPool?: Pool };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Exchanges a completed Stripe checkout session for an access pass.
 *
 * There is no webhook: the buyer's return from the Payment Link is the trigger,
 * and Stripe itself is asked whether that session was actually paid. Issuing is
 * idempotent, so reloading the success URL returns the same pass.
 */
export async function POST(request: Request) {
  const config = getAccessPassConfig();
  if (!config) return json({ error: "unavailable" }, 503);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const verification = await verifyCheckoutSession(parsed.data.checkoutSessionId, config.stripeSecretKey);
  if (verification.status === "invalid") return json({ error: "invalid_request" }, 400);
  if (verification.status === "unavailable") return json({ error: "unavailable" }, 503);
  if (verification.status === "unpaid") return json({ error: "not_paid" }, 402);

  const pool = (accessPool.__sugarAccessPool ??= new Pool({ connectionString: config.databaseUrl }));
  try {
    const pass = await issueAccessPass(pool, {
      checkoutSessionId: parsed.data.checkoutSessionId,
      email: verification.email,
      secret: config.accessPassSecret,
      now: new Date(),
    });
    return json(pass, 200);
  } catch {
    // The payment succeeded even though we could not store the pass. Say
    // nothing about the database; the buyer can restore by email once it is up.
    return json({ error: "unavailable" }, 503);
  }
}
