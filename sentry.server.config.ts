import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // The integration is deliberately inert until the server-only DSN is added
  // in Railway. This keeps local development and preview deployments silent.
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend(event) {
    // The scanner can handle images and nutrition data. Operational error
    // diagnostics need stacks and release metadata, never request/user data.
    delete event.request;
    delete event.user;
    return event;
  },
});
