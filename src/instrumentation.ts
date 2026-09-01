import type { Instrumentation } from "next";
import { sendOperationalIncident } from "@/lib/observability/telegram-alert";

/** Covers errors Next.js catches before an individual route can return a safe response. */
export const onRequestError: Instrumentation.onRequestError = async (_error, _request, context) => {
  // Use Next's route template, never the raw URL/query or error text: either
  // may contain user-provided data.
  await sendOperationalIncident({ kind: "unhandled_server_error", route: context.routePath });
};
