/** Runtime adapters are opt-in. A plain local app needs neither collector nor DSN. */
export async function register() {
  // Next replaces this runtime selector during compilation; keep edge bundles free of Node SDKs.
  // eslint-disable-next-line no-restricted-syntax -- Next requires a literal runtime selector to exclude Node SDKs from edge bundles.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverConfig } = await import("./lib/server-config");
    const config = serverConfig();
    if (config.OPENTENANT_OTLP_ENDPOINT) {
      const { tracingComponents, startNodeTracing } = await import("@opentenant/observability/node");
      if (config.VERCEL === "1") {
        const { registerOTel } = await import("@vercel/otel");
        registerOTel({ serviceName: "opentenant-platform", ...tracingComponents(config.OPENTENANT_OTLP_ENDPOINT), autoDetectResources: false, resourceDetectors: [], propagators: ["tracecontext"], metricReaders: [], logRecordProcessors: [] });
      } else {
        startNodeTracing(config.OPENTENANT_OTLP_ENDPOINT);
      }
    }
    if (config.SENTRY_DSN) {
      const { startErrorCapture } = await import("./lib/error-capture");
      await startErrorCapture(config.SENTRY_DSN);
    }
  }
}

export async function onRequestError() {
  // eslint-disable-next-line no-restricted-syntax -- Next requires a literal runtime selector to exclude Node SDKs from edge bundles.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverConfig } = await import("./lib/server-config");
    if (serverConfig().SENTRY_DSN) {
      const { captureServerError } = await import("./lib/error-capture");
      await captureServerError();
    }
  }
}
