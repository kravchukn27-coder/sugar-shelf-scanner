/** Maps the deliberately small proposal API surface to non-technical UI copy. */
export function catalogProposalSubmissionOutcome(status: number): "saved" | "duplicate" | "error" {
  if (status >= 200 && status < 300) return "saved";
  if (status === 409) return "duplicate";
  return "error";
}
