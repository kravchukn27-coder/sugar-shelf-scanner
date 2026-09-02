import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";
import { sendOperationalIncident } from "@/lib/observability/telegram-alert";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
}

/** Covers errors Next.js catches before an individual route can return a safe response. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Use Next's route template, never the raw URL/query or error text: either
  // may contain user-provided data.
  Sentry.captureRequestError(error, request, context);
  await sendOperationalIncident({ kind: "unhandled_server_error", route: context.routePath });
};
