import { z } from "zod";

/**
 * A user contribution is evidence for a curator, never a catalog record.
 * Keep this contract deliberately text-and-number only: raw recovery frames
 * and browser OCR text must not cross the device boundary.
 */
function validGtin(value: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;
  let sum = 0;
  for (let index = value.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) sum += Number(value[index]) * weight;
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

export const catalogProposalRequestSchema = z.object({
  gtin: z.string().refine(validGtin, "Expected a valid EAN, UPC, or GTIN"),
  brand: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  packSize: z.string().trim().min(1).max(40).nullable(),
  sugarPer100g: z.number().min(0).max(100).nullable(),
  proteinPer100g: z.number().min(0).max(100).nullable(),
  labelSeenLocally: z.boolean(),
});
export type CatalogProposalRequest = z.infer<typeof catalogProposalRequestSchema>;

export const catalogProposalResponseSchema = z.object({
  proposalId: z.string().uuid(),
  status: z.literal("pending_review"),
});

export interface ProposalQueryExecutor {
  query<Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export class PendingCatalogProposalExistsError extends Error {
  public constructor() { super("A pending proposal already exists for this GTIN"); }
}

export function proposalSaveFailure(error: unknown): { status: 409 | 503; message: string } {
  return error instanceof PendingCatalogProposalExistsError
    ? { status: 409, message: "This barcode is already waiting for curator review." }
    : { status: 503, message: "Couldn’t save your suggestion. Please try again later." };
}

export async function storePendingCatalogProposal(db: ProposalQueryExecutor, proposal: CatalogProposalRequest): Promise<string> {
  try {
    const result = await db.query<{ id: string }>(`
    INSERT INTO catalog_proposals (
      id, status, barcode_gtin, proposed_brand, proposed_name, proposed_pack_size,
      sugar_per_100g, protein_per_100g, label_seen_locally
    ) VALUES (
      gen_random_uuid(), 'pending_review', $1, $2, $3, $4, $5, $6, $7
    )
    RETURNING id
    `, [
    proposal.gtin,
    proposal.brand,
    proposal.name,
    proposal.packSize,
    proposal.sugarPer100g,
    proposal.proteinPer100g,
    proposal.labelSeenLocally,
    ]);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Proposal insert returned no id");
    return id;
  } catch (error) {
    // PostgreSQL unique_violation. Keep the database-specific shape local so
    // the API can provide an idempotent response without exposing SQL errors.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") throw new PendingCatalogProposalExistsError();
    throw error;
  }
}

/** A bounded best-effort guard; production should replace this with shared KV/WAF. */
export function createProposalRateLimiter(limit = 5, windowMs = 60 * 60 * 1000) {
  const buckets = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= limit) {
      buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    buckets.set(key, recent);
    return true;
  };
}
