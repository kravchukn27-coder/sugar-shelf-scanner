import { Pool } from "pg";
import { createProposalRateLimiter } from "@/lib/catalog/catalog-proposals";
import { handleCatalogProposal } from "@/lib/catalog/catalog-proposal-handler";
import { queueOperationalIncident } from "@/lib/observability/telegram-alert";

export const runtime = "nodejs";

const globalProposalPool = globalThis as typeof globalThis & { __sugarProposalPool?: Pool; __sugarProposalRateLimit?: ReturnType<typeof createProposalRateLimiter> };

function getProposalPool(databaseUrl: string): Pool {
  return globalProposalPool.__sugarProposalPool ??= new Pool({ connectionString: databaseUrl, max: 2, idleTimeoutMillis: 10_000 });
}

/**
 * Stores a curator-reviewable suggestion, never a trusted catalog entry.
 * The request schema accepts only user-confirmed text/numbers plus a local
 * label-presence flag—no image, OCR text, device ID, or IP is persisted.
 */
export async function POST(request: Request) {
  const databaseUrl = process.env.DATABASE_URL;
  const limiter = globalProposalPool.__sugarProposalRateLimit ??= createProposalRateLimiter();
  const response = await handleCatalogProposal(request, {
    databaseUrl,
    pool: databaseUrl ? getProposalPool(databaseUrl) : undefined,
    allowRequest: limiter,
  });
  if (response.status >= 500) queueOperationalIncident({ kind: "catalog_failure", route: "/api/catalog/proposals", status: response.status });
  return response;
}
