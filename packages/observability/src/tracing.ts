import { SpanStatusCode, trace } from "@opentelemetry/api";

export type PlatformSpanName = "tenant.resolve" | "identity.validate" | "module.proxy";
/** The callback's arguments, result, and exceptions never become span attributes. */
export function traceSpan<T>(name: PlatformSpanName, fn: () => Promise<T>): Promise<T> {
  return trace.getTracer("opentenant.platform").startActiveSpan(name, async (span) => {
    try {
      const result = await fn();
      if (result instanceof Response) span.setAttribute("http.response.status_code", result.status);
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

const ROUTES = new Set(["/api/ready", "/api/health", "/api/telemetry"]);
const NAMES = new Set(["tenant.resolve", "identity.validate", "module.proxy"]);
interface SpanData {
  name: string;
  attributes: Readonly<Record<string, unknown>>;
  events: readonly unknown[];
}
/** Apply at export, including to spans created by Next and pg instrumentation. */
export function safeSpan<T extends SpanData>(span: T): T {
  const attributes: Record<string, string | number> = {};
  const route = span.attributes["http.route"] ?? span.attributes["next.route"];
  if (typeof route === "string" && ROUTES.has(route)) attributes["http.route"] = route;
  for (const key of ["http.status_code", "http.response.status_code"] as const) {
    const value = span.attributes[key];
    if (typeof value === "number" && value >= 100 && value <= 599 && Number.isInteger(value)) attributes[key] = value;
  }
  const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
  const method = span.attributes["http.request.method"] ?? span.attributes["http.method"];
  if (typeof method === "string" && methods.has(method)) attributes["http.request.method"] = method;
  const name = NAMES.has(span.name) ? span.name
    : span.attributes["db.system"] === "postgresql" || span.attributes["db.system.name"] === "postgresql" ? "db.query" : "platform.request";
  const safe = Object.assign(Object.create(Object.getPrototypeOf(span)), span, {
    name, attributes, events: [], links: [],
    status: { code: "status" in span && (span.status as { code?: number })?.code === 2 ? 2 : 0 },
    resource: { attributes: { "service.name": "opentenant-platform" } },
    instrumentationScope: { name: "opentenant.platform" },
  });
  if ("spanContext" in span && typeof span.spanContext === "function") {
    const context = span.spanContext();
    safe.spanContext = () => ({ traceId: context.traceId, spanId: context.spanId, traceFlags: context.traceFlags });
  }
  return safe;
}

/** Discard SDK enrichments and exception strings rather than attempting blacklist scrubbing. */
export function scrubErrorEvent(input: unknown) {
  const event = input && typeof input === "object" ? input as { event_id?: unknown; timestamp?: unknown } : {};
  return {
    ...(typeof event.event_id === "string" && /^[a-f0-9]{32}$/.test(event.event_id) ? { event_id: event.event_id } : {}),
    ...(typeof event.timestamp === "number" && Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
    level: "error" as const,
    message: "Platform operation failed",
  };
}
