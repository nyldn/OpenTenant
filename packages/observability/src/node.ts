import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { safeSpan } from "./tracing";

/** A collector is never constructed without an explicit operator endpoint. */
export function tracingComponents(endpoint: string) {
  let target: URL;
  try { target = new URL(endpoint); } catch { throw new Error("Invalid trace collector configuration"); }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error("Invalid trace collector configuration");
  const exporter = new OTLPTraceExporter({ url: target.href, headers: {} });
  const traceExporter: SpanExporter = {
    export: (spans, callback) => exporter.export(spans.map(safeSpan), callback),
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush(),
  };
  return { traceExporter, instrumentations: [new PgInstrumentation({ enhancedDatabaseReporting: false })] };
}

export function startNodeTracing(endpoint: string) {
  const sdk = new NodeSDK({ serviceName: "opentenant-platform", ...tracingComponents(endpoint), autoDetectResources: false, metricReaders: [], logRecordProcessors: [] });
  sdk.start();
  return sdk;
}
