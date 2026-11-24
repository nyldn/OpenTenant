import pino, { type DestinationStream } from "pino";
import { trace } from "@opentelemetry/api";

const EVENTS = new Set(["request.completed", "telemetry.accepted", "operation.failed", "rate_limit.denied"]);
const OUTCOMES = new Set(["ok", "failed", "limited"]);

/** No messages, child bindings, serializers, request objects, or arbitrary strings. */
export function createLogger(destination?: DestinationStream) {
  const logger = pino({ base: null, redact: { paths: ["body", "cookies", "headers", "authorization", "connectionString"], remove: true } }, destination);
  function write(level: "info" | "warn" | "error", input: Readonly<Record<string, unknown>>) {
    const fields: Record<string, string | number> = {};
    if (typeof input.event === "string" && EVENTS.has(input.event)) fields.event = input.event;
    if (typeof input.outcome === "string" && OUTCOMES.has(input.outcome)) fields.outcome = input.outcome;
    if (typeof input.statusCode === "number" && Number.isInteger(input.statusCode) && input.statusCode >= 100 && input.statusCode <= 599) fields.statusCode = input.statusCode;
    if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs >= 0) fields.durationMs = input.durationMs;
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    if (traceId && /^[a-f0-9]{32}$/.test(traceId) && !/^0+$/.test(traceId)) fields.traceId = traceId;
    logger[level](fields);
  }
  return {
    info: (fields: Readonly<Record<string, unknown>>) => write("info", fields),
    warn: (fields: Readonly<Record<string, unknown>>) => write("warn", fields),
    error: (fields: Readonly<Record<string, unknown>>) => write("error", fields),
  };
}
