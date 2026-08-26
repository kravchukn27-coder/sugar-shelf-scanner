import type { ResolutionStatus } from "@/lib/contracts/product";

/** The recovery entrypoint belongs exclusively in open Details for unresolved products. */
export function shouldOfferBarcodeRecovery(status: ResolutionStatus, detailsOpen: boolean): boolean {
  return detailsOpen && status !== "confirmed";
}
