import { Pool } from "pg";
import { catalogProposalRequestSchema, catalogProposalResponseSchema, createProposalRateLimiter, proposalSaveFailure, storePendingCatalogProposal } from "@/lib/catalog/catalog-proposals";

export const runtime = "nodejs";

const globalProposalPool = globalThis as typeof globalThis & { __sugarProposalPool?: Pool; __sugarProposalRateLimit?: ReturnType<typeof createProposalRateLimiter> };

function getRequesterKey(request: Request): string {
  // Railway supplies x-forwarded-for. Only its first address identifies the
  // client; never retain it in the proposal record or application logs.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
}

function getProposalPool(databaseUrl: string): Pool {
  return globalProposalPool.__sugarProposalPool ??= new Pool({ connectionString: databaseUrl, max: 2, idleTimeoutMillis: 10_000 });
}

/**
 * Stores a curator-reviewable suggestion, never a trusted catalog entry.
 * The request schema accepts only user-confirmed text/numbers plus a local
 * label-presence flag—no image, OCR text, device ID, or IP is persisted.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = catalogProposalRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Check the barcode and required product details." }, { status: 400 });

  const limiter = globalProposalPool.__sugarProposalRateLimit ??= createProposalRateLimiter();
  if (!limiter(getRequesterKey(request))) return Response.json({ error: "Too many suggestions. Please try again later." }, { status: 429 });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return Response.json({ error: "Catalog suggestions are not available yet." }, { status: 503 });
  try {
    const proposalId = await storePendingCatalogProposal(getProposalPool(databaseUrl), parsed.data);
    return Response.json(catalogProposalResponseSchema.parse({ proposalId, status: "pending_review" }), { status: 201 });
  } catch (error) {
    const failure = proposalSaveFailure(error);
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
