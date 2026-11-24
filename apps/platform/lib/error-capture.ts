import "server-only";
import { scrubErrorEvent } from "@opentenant/observability/tracing";

/** Accept any Sentry-protocol endpoint. No integrations inspect requests or tenant content. */
export async function startErrorCapture(dsn: string) {
  try {
    const target = new URL(dsn);
    if (!["http:", "https:"].includes(target.protocol) || !target.username || target.password || !/\/[0-9]+$/.test(target.pathname) || target.search || target.hash) throw new Error();
  } catch { throw new Error("Invalid error capture configuration"); }
  const sentry = await import("@sentry/nextjs");
  // SDK 11 replaces sendDefaultPii with per-category collection controls.
  // Keep the legacy flag explicitly false alongside SDK 11's enforced policy.
  const compatibilityPrivacy = { sendDefaultPii: false, autoSessionTracking: false, enableLogs: false };
  sentry.init({
    ...compatibilityPrivacy,
    dsn,
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
      urlQueryParams: false, databaseQueryData: false, queues: false,
      stackFrameVariables: false, frameContextLines: 0,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false },
    },
    includeServerName: false,
    attachStacktrace: false,
    sendClientReports: false,
    defaultIntegrations: false,
    enableOpenTelemetrySetup: false,
    debug: false,
    spotlight: false,
    beforeSendLog: () => null,
    tracesSampleRate: 0,
    beforeSend: (event) => ({ ...scrubErrorEvent(event), type: undefined }),
    beforeBreadcrumb: () => null,
  });
}

export async function captureServerError(): Promise<void> {
  const sentry = await import("@sentry/nextjs");
  // Deliberately do not pass the original error, request, URL or Next context.
  sentry.captureEvent({ level: "error", message: "Platform operation failed" });
}
