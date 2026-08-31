/**
 * Verifies one completed Stripe Checkout session over the REST API.
 *
 * There is no Stripe SDK and no webhook endpoint on purpose. The buyer returns
 * from the Payment Link with a session id, we ask Stripe once whether that
 * session is paid, and that is the entire integration — which is what makes
 * this test feature removable in an afternoon.
 */
export type CheckoutVerification =
  | { status: "paid"; email: string }
  | { status: "unpaid" }
  | { status: "invalid" }
  | { status: "unavailable" };

/** Stripe checkout session ids. Validated before use so the id cannot walk the API path. */
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{8,80}$/;

export async function verifyCheckoutSession(
  sessionId: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutVerification> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return { status: "invalid" };

  let response: Response;
  try {
    response = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { authorization: `Bearer ${secretKey}` },
    });
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 404) return { status: "invalid" };
  if (!response.ok) return { status: "unavailable" };

  const body = (await response.json().catch(() => null)) as
    | { payment_status?: unknown; customer_details?: { email?: unknown } | null }
    | null;
  if (!body) return { status: "unavailable" };
  if (body.payment_status !== "paid") return { status: "unpaid" };

  const email = body.customer_details?.email;
  // A paid session with no address cannot be turned into a restorable pass.
  // Reporting it as unpaid would blame the buyer for our configuration.
  if (typeof email !== "string" || email.length === 0) return { status: "unavailable" };
  return { status: "paid", email };
}
