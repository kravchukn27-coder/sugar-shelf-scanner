import {
  catalogProposalDuplicateResponseSchema,
  catalogProposalRequestSchema,
  PendingCatalogProposalExistsError,
  proposalSaveFailure,
  storePendingCatalogProposal,
  type ProposalQueryExecutor,
} from "./catalog-proposals";

export type ProposalHandlerDependencies = {
  databaseUrl?: string;
  pool?: ProposalQueryExecutor;
  allowRequest?: (requesterKey: string) => boolean;
};

function requesterKey(request: Request): string {
  // This value is used only during the rate-limit decision. It must never be
  // written to the review record or response/log payload.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
}

function proposalJson(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Shared testable proposal path. Its successful response is sourced from the
 * row PostgreSQL returned, so it cannot accidentally claim curator-queue
 * acceptance before persistence has succeeded.
 */
export async function handleCatalogProposal(request: Request, dependencies: ProposalHandlerDependencies) {
  const body = await request.json().catch(() => null);
  const parsed = catalogProposalRequestSchema.safeParse(body);
  if (!parsed.success) return proposalJson({ error: "Check the barcode and required product details." }, 400);

  if (!dependencies.allowRequest?.(requesterKey(request))) {
    return proposalJson({ error: "Too many suggestions. Please try again later." }, 429);
  }
  if (!dependencies.databaseUrl || !dependencies.pool) {
    return proposalJson({ error: "Catalog suggestions are not available yet." }, 503);
  }

  try {
    const persisted = await storePendingCatalogProposal(dependencies.pool, parsed.data);
    return proposalJson(persisted, 201);
  } catch (error) {
    if (error instanceof PendingCatalogProposalExistsError) {
      return proposalJson(catalogProposalDuplicateResponseSchema.parse({ outcome: "already_pending_review", status: "pending_review" }), 409);
    }
    const failure = proposalSaveFailure(error);
    return proposalJson({ error: failure.message }, failure.status);
  }
}
