import { z } from "zod";

const serverEnvSchema = z.object({
  VISION_PROVIDER: z.enum(["mock", "gemini"]).default("mock"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_VISION_MODEL: z.string().min(1).default("gemini-3.6-flash"),
  // Optional override. By default preflight uses the known-working full model
  // configured for this Railway service.
  GEMINI_PREFLIGHT_MODEL: z.string().min(1).optional(),
  // Setting this turns on a 50/50 random split per preflight call between
  // GEMINI_PREFLIGHT_MODEL and this one, so both models see the same
  // concurrent traffic and provider conditions instead of a before/after
  // comparison confounded by Gemini's own latency drifting hour to hour.
  // Unset (the default) disables the split entirely — no random branch runs.
  GEMINI_PREFLIGHT_MODEL_VARIANT_B: z.string().min(1).optional(),
  // Same concurrent-split mechanism as the preflight variant above, applied
  // to the full analyze call instead. A single choice is reused for the
  // primary attempt, its hedge duplicate (if one fires), and the one
  // transport-failure retry, so one logical scan never mixes two models.
  GEMINI_ANALYZE_MODEL_VARIANT_B: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().optional(),
  RATE_LIMIT_SECRET: z.string().min(16).optional(),
  // Optional: enables the free USDA Branded Foods fallback. Never expose it to iOS.
  USDA_FDC_API_KEY: z.string().min(1).optional(),
  // Open Food Facts asks integrators to identify their app and contact address.
  OPEN_FOOD_FACTS_USER_AGENT: z.string().min(1).optional(),
  // Monetization test. Server-only: the secret key must never be inlined into
  // a browser bundle, so it is deliberately not a NEXT_PUBLIC_ variable.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  // Server-only signing secret for Stripe's webhook endpoint. It is distinct
  // from STRIPE_SECRET_KEY and begins with whsec_ in Stripe's dashboard.
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Keys the buyer-email digest stored with an access pass. Rotating it makes
  // every existing pass unrestorable by email, so treat the value as durable
  // for the life of the test.
  ACCESS_PASS_SECRET: z.string().min(16).optional(),
  // Durable server-only key used to turn a browser-local random installation
  // ID into an irreversible analytics subject digest. Do not rotate it while
  // historical DAU/WAU/MAU comparisons matter.
  ANALYTICS_SUBJECT_SECRET: z.string().min(16).optional(),
  GOOGLE_CLOUD_BILLING_PROJECT_ID: z.string().min(6).optional(),
  GOOGLE_CLOUD_BILLING_DATASET_ID: z.string().min(1).optional(),
  GOOGLE_CLOUD_BILLING_SERVICE_ACCOUNT_JSON_BASE64: z.string().min(1).optional(),
});

export type ServerEnv = Omit<z.infer<typeof serverEnvSchema>, "GEMINI_PREFLIGHT_MODEL"> & {
  GEMINI_PREFLIGHT_MODEL: string;
};

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.parse(process.env);
  if (parsed.VISION_PROVIDER === "gemini" && !parsed.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required when VISION_PROVIDER=gemini.");
  }
  return { ...parsed, GEMINI_PREFLIGHT_MODEL: parsed.GEMINI_PREFLIGHT_MODEL ?? parsed.GEMINI_VISION_MODEL };
}

/**
 * This helper is safe to use before request validation/configuration (for
 * example, on an early rate-limit response). Invalid or absent values fail
 * closed, so an old browser never receives telemetry permission by accident.
 */
export function isScannerMetricsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.SCANNER_METRICS_ENABLED === "true";
}

/** Durable dashboard event storage is server-only and requires PostgreSQL. */
export function isAnalyticsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.ANALYTICS_ENABLED === "true" && Boolean(environment.DATABASE_URL);
}

/**
 * Provider token counters are a temporary, server-only diagnostic. Keep this
 * separate from browser scanner summaries so a public build flag can never
 * enable usage logging by itself.
 */
export function isVisionUsageMetricsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.VISION_USAGE_METRICS_ENABLED === "true";
}

export type AccessPassConfig = {
  stripeSecretKey: string;
  accessPassSecret: string;
  databaseUrl: string;
};

export type StripeWebhookConfig = {
  stripeWebhookSecret: string;
  accessPassSecret: string;
  databaseUrl: string;
};

/**
 * The paid-access routes need three independent pieces of configuration. A
 * partially configured deployment must not half-work: it answers 503 rather
 * than issuing a pass it cannot store, or storing a digest under a weak key.
 */
export function getAccessPassConfig(environment: NodeJS.ProcessEnv = process.env): AccessPassConfig | null {
  const stripeSecretKey = environment.STRIPE_SECRET_KEY;
  const accessPassSecret = environment.ACCESS_PASS_SECRET;
  const databaseUrl = environment.DATABASE_URL;
  if (!stripeSecretKey) return null;
  if (!accessPassSecret || accessPassSecret.length < 16) return null;
  if (!databaseUrl) return null;
  return { stripeSecretKey, accessPassSecret, databaseUrl };
}

/**
 * The webhook authenticates with its own Stripe signing secret, then needs the
 * same durable storage and email-digest secret as the browser redemption path.
 * A partial setup returns 503 so Stripe retries instead of silently losing a
 * completed payment.
 */
export function getStripeWebhookConfig(environment: NodeJS.ProcessEnv = process.env): StripeWebhookConfig | null {
  const stripeWebhookSecret = environment.STRIPE_WEBHOOK_SECRET;
  const accessPassSecret = environment.ACCESS_PASS_SECRET;
  const databaseUrl = environment.DATABASE_URL;
  if (!stripeWebhookSecret) return null;
  if (!accessPassSecret || accessPassSecret.length < 16) return null;
  if (!databaseUrl) return null;
  return { stripeWebhookSecret, accessPassSecret, databaseUrl };
}
