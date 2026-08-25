import { z } from "zod";

const serverEnvSchema = z.object({
  VISION_PROVIDER: z.enum(["mock", "gemini"]).default("mock"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_VISION_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  DATABASE_URL: z.string().url().optional(),
  RATE_LIMIT_SECRET: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.parse(process.env);
  if (parsed.VISION_PROVIDER === "gemini" && !parsed.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required when VISION_PROVIDER=gemini.");
  }
  return parsed;
}
