type IncidentKind = "health_unavailable" | "scan_failure" | "access_failure" | "stripe_webhook_failure" | "catalog_failure" | "unhandled_server_error";

export type OperationalIncident = {
  kind: IncidentKind;
  route: string;
  status?: number;
  code?: string;
};

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const COOLDOWN_MS = 15 * 60_000;
const alertStateKey = "__sugarTelegramAlertCooldown";
const alertState = globalThis as typeof globalThis & { [alertStateKey]?: Map<string, number> };

function configured(environment: NodeJS.ProcessEnv) {
  return environment.TELEGRAM_ALERTS_ENABLED === "true"
    && /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(environment.TELEGRAM_ALERT_BOT_TOKEN ?? "")
    && /^-?\d+$/.test(environment.TELEGRAM_ALERT_CHAT_ID ?? "");
}

function cooldowns() {
  return alertState[alertStateKey] ??= new Map<string, number>();
}

function message(incident: OperationalIncident) {
  const fields = [
    "🚨 Sugar Camera · production incident",
    `Kind: ${incident.kind}`,
    `Route: ${incident.route}`,
    incident.status ? `HTTP: ${incident.status}` : null,
    incident.code ? `Code: ${incident.code}` : null,
    "Action: check Railway logs and /admin/analytics; acknowledge in this chat.",
  ].filter((field): field is string => Boolean(field));
  return fields.join("\n");
}

/**
 * Best-effort incident delivery. It is intentionally unable to affect a user
 * response, and only sends an allowlisted operational summary to Telegram.
 */
export async function sendOperationalIncident(incident: OperationalIncident, environment: NodeJS.ProcessEnv = process.env, fetchImpl: Fetch = fetch) {
  if (!configured(environment)) return;
  const key = `${incident.kind}:${incident.route}:${incident.status ?? "none"}:${incident.code ?? "none"}`;
  const now = Date.now();
  const previous = cooldowns().get(key) ?? 0;
  if (now - previous < COOLDOWN_MS) return;
  cooldowns().set(key, now);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    await fetchImpl(`https://api.telegram.org/bot${environment.TELEGRAM_ALERT_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: environment.TELEGRAM_ALERT_CHAT_ID, text: message(incident), disable_web_page_preview: true }),
      signal: controller.signal,
    });
  } catch {
    // A notification failure is not allowed to affect the application.
  } finally {
    clearTimeout(timeout);
  }
}

export function queueOperationalIncident(incident: OperationalIncident) {
  void sendOperationalIncident(incident);
}

/** Test-only reset; production state lives per process and expires naturally. */
export function resetOperationalIncidentCooldownsForTests() {
  cooldowns().clear();
}
