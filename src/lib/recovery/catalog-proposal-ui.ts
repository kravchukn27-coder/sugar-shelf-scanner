/** Maps the deliberately small proposal API surface to non-technical UI copy. */
export function catalogProposalSubmissionOutcome(status: number): "saved" | "duplicate" | "error" {
  if (status >= 200 && status < 300) return "saved";
  if (status === 409) return "duplicate";
  return "error";
}

/** Fallback copy shown when the server didn't give us a usable error message. */
export const GENERIC_PROPOSAL_ERROR_MESSAGE = "Couldn’t submit the draft. Your edits are still here — try again.";

/**
 * Reads the small `{ error: string }` body the proposal API sends on 400/429/503
 * responses so the UI can show the specific reason instead of generic copy.
 * Falls back to the generic message if the body isn't JSON or has no usable `error` field.
 */
export async function catalogProposalErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body) {
      const message = (body as { error: unknown }).error;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // Body wasn't JSON (or was already consumed) — fall through to generic copy.
  }
  return GENERIC_PROPOSAL_ERROR_MESSAGE;
}
