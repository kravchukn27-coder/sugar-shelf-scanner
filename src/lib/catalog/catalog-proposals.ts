import { z } from "zod";
import { createHash } from "node:crypto";
import { normalizeText } from "./normalization";

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

const nutritionValueSchema = z.number().finite().min(0).max(100).nullable().default(null);
const nutritionFieldConfidenceSchema = z.object({
  energyKcal: z.number().finite().min(0).max(1).nullable(),
  proteinPer100g: z.number().finite().min(0).max(1).nullable(),
  fatPer100g: z.number().finite().min(0).max(1).nullable(),
  carbohydratesPer100g: z.number().finite().min(0).max(1).nullable(),
  sugarPer100g: z.number().finite().min(0).max(1).nullable(),
}).strict().nullable().default(null);

export const catalogProposalRequestSchema = z.object({
  gtin: z.string().refine(validGtin, "Expected a valid EAN, UPC, or GTIN").nullable().default(null),
  brand: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  packSize: z.string().trim().min(1).max(40).nullable(),
  energyKcal: z.number().finite().min(0).max(2000).nullable().default(null),
  proteinPer100g: nutritionValueSchema,
  fatPer100g: nutritionValueSchema,
  carbohydratesPer100g: nutritionValueSchema,
  sugarPer100g: nutritionValueSchema,
  // Retained for the pre-recovery form. It is only a boolean observation and
  // never represents OCR text or image retention.
  labelSeenLocally: z.boolean().default(false),
  intakeProvenance: z.enum(["user_entered", "gemini_label"]).default("user_entered"),
  labelCaptureConsented: z.boolean().default(false),
  nutritionFieldConfidence: nutritionFieldConfidenceSchema,
}).strict().superRefine((proposal, context) => {
  if (proposal.intakeProvenance === "gemini_label" && !proposal.labelCaptureConsented) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["labelCaptureConsented"], message: "Label extraction requires explicit capture consent" });
  }
});
export type CatalogProposalRequest = z.infer<typeof catalogProposalRequestSchema>;

/**
 * A label-first proposal has no global identifier. Hashing the consistently
 * normalised user-confirmed identity gives the review queue a bounded duplicate
 * key without storing additional raw capture material.
 */
export function proposalIdentityDedupeKey(proposal: Pick<CatalogProposalRequest, "brand" | "name" | "packSize">): string {
  const identity = [proposal.brand, proposal.name, proposal.packSize ?? ""].map(normalizeText).join("|");
  return createHash("sha256").update(`sugar-shelf-scanner:proposal:${identity}`).digest("hex");
}

/**
 * `outcome` is intentionally explicit: a client may acknowledge only a row
 * that PostgreSQL has returned as pending review. It must never infer durable
 * acceptance from a locally assembled request.
 */
export const catalogProposalResponseSchema = z.object({
  outcome: z.literal("created"),
  proposalId: z.string().uuid(),
  status: z.literal("pending_review"),
}).strict();

export const catalogProposalDuplicateResponseSchema = z.object({
  outcome: z.literal("already_pending_review"),
  status: z.literal("pending_review"),
}).strict();

export interface ProposalQueryExecutor {
  query<Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export type PendingCatalogProposal = z.infer<typeof catalogProposalResponseSchema>;

export class PendingCatalogProposalExistsError extends Error {
  public constructor() { super("A pending proposal already exists for this identity"); }
}

export function proposalSaveFailure(error: unknown): { status: 409 | 503; message: string } {
  return error instanceof PendingCatalogProposalExistsError
    ? { status: 409, message: "This product is already waiting for curator review." }
    : { status: 503, message: "Couldn’t save your suggestion. Please try again later." };
}

export async function storePendingCatalogProposal(db: ProposalQueryExecutor, proposal: CatalogProposalRequest): Promise<PendingCatalogProposal> {
  try {
    const result = await db.query<{ id: string; status: string }>(`
    INSERT INTO catalog_proposals (
      id, status, barcode_gtin, proposed_brand, proposed_name, proposed_pack_size,
      identity_dedupe_key, energy_kcal_per_100g, protein_per_100g, fat_per_100g,
      carbohydrates_per_100g, sugar_per_100g, label_seen_locally,
      intake_provenance, label_capture_consented, nutrition_field_confidence
    ) VALUES (
      gen_random_uuid(), 'pending_review', $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14
    )
    RETURNING id, status
    `, [
      proposal.gtin,
      proposal.brand,
      proposal.name,
      proposal.packSize,
      proposalIdentityDedupeKey(proposal),
      proposal.energyKcal,
      proposal.proteinPer100g,
      proposal.fatPer100g,
      proposal.carbohydratesPer100g,
      proposal.sugarPer100g,
      proposal.labelSeenLocally,
      proposal.intakeProvenance,
      proposal.labelCaptureConsented,
      proposal.nutritionFieldConfidence,
    ]);
    const row = result.rows[0];
    // This parses the row returned by PostgreSQL, rather than trusting the
    // SQL literal alone. If a migration or trigger changes the status, the
    // request fails closed and the UI cannot claim it entered review.
    return catalogProposalResponseSchema.parse({
      outcome: "created",
      proposalId: row?.id,
      status: row?.status,
    });
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
