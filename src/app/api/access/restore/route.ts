import { Pool } from "pg";
import { z } from "zod";
import { findActivePassByEmail } from "@/lib/access/access-pass";
import { getAccessPassConfig } from "@/lib/env";
import { checkScanRateLimit } from "@/lib/observability/scan-route";

export const runtime = "nodejs";

const bodySchema = z.object({ email: z.string().email().max(254) }).strict();

const accessPool = globalThis as typeof globalThis & { __sugarAccessPool?: Pool };

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Returns an active pass for the address the buyer paid with.
 *
 * This is what makes a purchase survive the browser it was made in — an ad
 * click opens in the Instagram in-app browser, whose storage is isolated from
 * Safari. It is rate limited because it is the one endpoint where guessing an
 * address would gain anything.
 */
export async function POST(request: Request) {
  const config = getAccessPassConfig();
  if (!config) return json({ error: "unavailable" }, 503);

  const rateLimit = checkScanRateLimit(request, {
    scope: "access_restore",
    limit: 10,
    windowMs: 60_000,
    secret: process.env.RATE_LIMIT_SECRET,
  });
  if (!rateLimit.allowed) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": String(rateLimit.retryAfterSeconds) });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const pool = (accessPool.__sugarAccessPool ??= new Pool({ connectionString: config.databaseUrl }));
  try {
    const pass = await findActivePassByEmail(pool, {
      email: parsed.data.email,
      secret: config.accessPassSecret,
      now: new Date(),
    });
    if (!pass) return json({ error: "not_found" }, 404);
    return json(pass, 200);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
