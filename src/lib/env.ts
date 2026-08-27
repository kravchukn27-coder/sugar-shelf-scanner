import { z } from "zod";

const serverEnvSchema = z.object({
  VISION_PROVIDER: z.enum(["mock", "gemini"]).default("mock"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_VISION_MODEL: z.string().min(1).default("gemini-3.6-flash"),
  // Optional override. By default preflight uses the known-working full model
  // configured for this Railway service.
  GEMINI_PREFLIGHT_MODEL: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().optional(),
  RATE_LIMIT_SECRET: z.string().min(16).optional(),
  // Optional: enables the free USDA Branded Foods fallback. Never expose it to iOS.
  USDA_FDC_API_KEY: z.string().min(1).optional(),
  // Open Food Facts asks integrators to identify their app and contact address.
  OPEN_FOOD_FACTS_USER_AGENT: z.string().min(1).optional(),
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

/**
 * Provider token counters are a temporary, server-only diagnostic. Keep this
 * separate from browser scanner summaries so a public build flag can never
 * enable usage logging by itself.
 */
export function isVisionUsageMetricsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.VISION_USAGE_METRICS_ENABLED === "true";
}
