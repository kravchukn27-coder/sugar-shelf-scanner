import { createHmac, randomBytes } from "node:crypto";
import type { SqlQueryExecutor } from "@/lib/catalog/repository";

/** One payment buys this many days of unlimited scanning. */
export const ACCESS_WINDOW_DAYS = 7;

export type AccessPass = { token: string; expiresAt: string };

export function createAccessToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * The buyer's address is never stored in readable form. A keyed digest answers
 * the only question the restore flow asks — "does this address own an active
 * pass?" — while leaving nothing contactable in the database.
 */
export function digestEmail(email: string, secret: string): string {
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

type PassRow = { token: string; expires_at: string | Date };

function fromRow(row: PassRow): AccessPass {
  return { token: row.token, expiresAt: new Date(row.expires_at).toISOString() };
}

/**
 * Idempotent on the checkout session: a buyer who reloads the Stripe success
 * URL, or opens it on a second device, gets the same pass rather than a new
 * one per visit.
 */
export async function issueAccessPass(
  db: SqlQueryExecutor,
  input: { checkoutSessionId: string; email: string; secret: string; now: Date },
): Promise<AccessPass> {
  const expiresAt = new Date(input.now.getTime() + ACCESS_WINDOW_DAYS * 86_400_000);
  await db.query(
    `INSERT INTO access_passes (token, checkout_session_id, email_digest, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (checkout_session_id) DO NOTHING`,
    [
      createAccessToken(),
      input.checkoutSessionId,
      digestEmail(input.email, input.secret),
      input.now.toISOString(),
      expiresAt.toISOString(),
    ],
  );
  const { rows } = await db.query<PassRow>(
    `SELECT token, expires_at FROM access_passes WHERE checkout_session_id = $1`,
    [input.checkoutSessionId],
  );
  const row = rows[0];
  if (!row) throw new Error("Access pass insert did not produce a row.");
  return fromRow(row);
}

export async function findActivePassByEmail(
  db: SqlQueryExecutor,
  input: { email: string; secret: string; now: Date },
): Promise<AccessPass | null> {
  const { rows } = await db.query<PassRow>(
    `SELECT token, expires_at FROM access_passes
     WHERE email_digest = $1 AND expires_at > $2
     ORDER BY expires_at DESC LIMIT 1`,
    [digestEmail(input.email, input.secret), input.now.toISOString()],
  );
  const row = rows[0];
  return row ? fromRow(row) : null;
}
