import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const stripeEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  created: z.number().int().nonnegative(),
  data: z.object({ object: z.record(z.unknown()) }),
});

export type StripeWebhookEvent = z.infer<typeof stripeEventSchema>;

export type StripePaymentLedgerEntry = {
  stripeEventId: string;
  eventType: string;
  eventCreatedAt: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  customerId: string | null;
  paymentStatus: string | null;
  amountTotal: number | null;
  amountRefunded: number | null;
  currency: string | null;
  email: string | null;
};

export type PaidCheckoutLedgerEntry = StripePaymentLedgerEntry & {
  checkoutSessionId: string;
  email: string;
};

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readAmount(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readEmail(record: Record<string, unknown>): string | null {
  const customerDetails = record.customer_details;
  if (customerDetails && typeof customerDetails === "object" && !Array.isArray(customerDetails)) {
    const email = readString(customerDetails as Record<string, unknown>, "email");
    if (email) return email;
  }
  return readString(record, "customer_email");
}

/**
 * Converts the Stripe event envelope into the compact payment facts consumed
 * by the ledger. The raw webhook payload (which can contain billing details)
 * is intentionally never persisted.
 */
export function toStripePaymentLedgerEntry(event: StripeWebhookEvent): StripePaymentLedgerEntry | null {
  const object = event.data.object;
  const base = {
    stripeEventId: event.id,
    eventType: event.type,
    eventCreatedAt: new Date(event.created * 1_000).toISOString(),
  };

  if (event.type.startsWith("checkout.session.")) {
    return {
      ...base,
      checkoutSessionId: readString(object, "id"),
      paymentIntentId: readString(object, "payment_intent"),
      customerId: readString(object, "customer"),
      paymentStatus: readString(object, "payment_status"),
      amountTotal: readAmount(object, "amount_total"),
      amountRefunded: null,
      currency: readString(object, "currency"),
      email: readEmail(object),
    };
  }

  if (event.type === "charge.refunded") {
    return {
      ...base,
      checkoutSessionId: null,
      paymentIntentId: readString(object, "payment_intent"),
      customerId: readString(object, "customer"),
      paymentStatus: "refunded",
      amountTotal: readAmount(object, "amount"),
      amountRefunded: readAmount(object, "amount_refunded"),
      currency: readString(object, "currency"),
      email: null,
    };
  }

  return null;
}

export function isPaidCheckoutEvent(entry: StripePaymentLedgerEntry): entry is PaidCheckoutLedgerEntry {
  return (entry.eventType === "checkout.session.completed" || entry.eventType === "checkout.session.async_payment_succeeded")
    && entry.paymentStatus === "paid"
    && entry.checkoutSessionId !== null
    && entry.email !== null;
}

function expectedSignature(payload: string, timestamp: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest();
}

/** Verifies Stripe's v1 signature before any payload is parsed or recorded. */
export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  now: Date = new Date(),
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;

  const age = Math.abs(Math.floor(now.getTime() / 1_000) - Number(timestamp));
  if (!Number.isSafeInteger(Number(timestamp)) || age > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = expectedSignature(payload, timestamp, secret);
  return parts
    .filter((part) => part.startsWith("v1="))
    .some((part) => {
      const candidate = part.slice(3);
      if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
      const actual = Buffer.from(candidate, "hex");
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
}

export function parseStripeWebhookEvent(payload: string): StripeWebhookEvent | null {
  try {
    return stripeEventSchema.safeParse(JSON.parse(payload)).data ?? null;
  } catch {
    return null;
  }
}
