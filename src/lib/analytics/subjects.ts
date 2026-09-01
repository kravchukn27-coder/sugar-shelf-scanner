import { createHmac } from "node:crypto";

/** The browser sends a random installation token; only this keyed digest persists. */
export function anonymizeAnalyticsSubject(anonymousId: string | undefined, secret: string | undefined): string | null {
  if (!anonymousId || !secret || secret.length < 16) return null;
  if (!/^[a-f0-9]{32}$/i.test(anonymousId)) return null;
  return createHmac("sha256", secret).update(`sugar-analytics:v1:${anonymousId}`).digest("hex");
}
