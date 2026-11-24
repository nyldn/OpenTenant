/**
 * Content-free telemetry contract (architecture spec section 13).
 *
 * Events carry identifiers, enums, counts, and outcomes only. The allowlist
 * below is the single authority on what may be recorded; validation rejects
 * unknown events and unexpected properties, so client content can never ride
 * along. Respondent names, answers, notes, engagement JSON, prompts, and
 * generated content are never telemetry.
 */

export interface TelemetryEvent {
  /** Allowlisted event name, e.g. "sample.readout.completed". */
  name: string;
  /** Pseudonymous tenant identifier; never a display name. */
  tenantId: string | null;
  moduleKey: string;
  moduleVersion: string;
  occurredAt: string;
  /** Allowlisted properties only; values limited to primitives. */
  properties: Record<string, string | number | boolean>;
}

/** Event name -> allowed property keys. Anything else fails validation. */
export type TelemetrySchemas = Readonly<Record<string, Readonly<Record<string, "string" | "number" | "boolean">>>>;
const PLATFORM_TELEMETRY_SCHEMAS: TelemetrySchemas = { "platform.health.checked": {} };
export const TELEMETRY_ALLOWLIST = Object.fromEntries(Object.entries(PLATFORM_TELEMETRY_SCHEMAS).map(([name, schema]) => [name, Object.keys(schema)]));

export type TelemetryValidation =
  | { ok: true; event: TelemetryEvent }
  | { ok: false; reason: string };

const TELEMETRY_FIELDS = [
  "name",
  "tenantId",
  "moduleKey",
  "moduleVersion",
  "occurredAt",
  "properties",
] as const;
const MAX_STRING_LENGTH = 64;
const MAX_NUMERIC_VALUE = 10_000_000;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTITY.test(value);
}

export function validateTelemetryEvent(input: unknown, contributions: TelemetrySchemas = {}): TelemetryValidation {
  if (!isPlainRecord(input)) return { ok: false, reason: "not an object" };
  const e = input;
  const schemas = { ...PLATFORM_TELEMETRY_SCHEMAS, ...contributions };

  if (
    Reflect.ownKeys(e).length !== TELEMETRY_FIELDS.length ||
    Reflect.ownKeys(e).some((field) => typeof field !== "string") ||
    TELEMETRY_FIELDS.some((field) => !Object.hasOwn(e, field))
  ) {
    return { ok: false, reason: "invalid event shape" };
  }

  // Object.hasOwn avoids prototype-chain names (__proto__, constructor)
  // matching the allowlist lookup.
  if (typeof e.name !== "string" || !Object.hasOwn(schemas, e.name)) {
    return { ok: false, reason: "unknown event name" };
  }
  if (!isBoundedIdentity(e.moduleKey) || !isBoundedIdentity(e.moduleVersion)) {
    return { ok: false, reason: "missing module identity" };
  }
  const eventModule = e.name.slice(0, e.name.indexOf("."));
  if (e.moduleKey !== eventModule) return { ok: false, reason: "event and module mismatch" };
  if (
    typeof e.occurredAt !== "string" ||
    e.occurredAt.length > MAX_STRING_LENGTH ||
    Number.isNaN(Date.parse(e.occurredAt))
  ) {
    return { ok: false, reason: "invalid timestamp" };
  }
  if (e.tenantId !== null && !isBoundedIdentity(e.tenantId)) {
    return { ok: false, reason: "invalid tenantId" };
  }
  if (!isPlainRecord(e.properties)) {
    return { ok: false, reason: "missing properties" };
  }

  const propertyTypes = schemas[e.name] ?? {};
  const allowed = new Set(Object.keys(propertyTypes));
  const canonicalProperties: Record<string, string | number | boolean> = {};
  for (const key of Reflect.ownKeys(e.properties)) {
    if (typeof key !== "string") {
      return { ok: false, reason: `property not allowlisted for ${String(e.name)}` };
    }
    if (!allowed.has(key)) {
      return { ok: false, reason: "property not allowlisted" };
    }
    const value = e.properties[key];
    const t = typeof value;
    if (t !== "string" && t !== "number" && t !== "boolean") {
      return { ok: false, reason: `property ${key} has non-primitive value` };
    }
    if (propertyTypes[key] !== t) {
      if (propertyTypes[key] === "number") {
        return { ok: false, reason: `property ${key} must be a number in [0, ${MAX_NUMERIC_VALUE}]` };
      }
      return { ok: false, reason: `property ${key} must be a ${propertyTypes[key] ?? "primitive"}` };
    }
    if (t === "string" && (value as string).length > MAX_STRING_LENGTH) {
      return { ok: false, reason: `property ${key} exceeds ${MAX_STRING_LENGTH} chars` };
    }
    if (t === "string" && !isBoundedIdentity(value)) {
      return { ok: false, reason: `property ${key} has an invalid string value` };
    }
    if (t === "number") {
      if (t !== "number" || !Number.isFinite(value as number) || (value as number) < 0 || (value as number) > MAX_NUMERIC_VALUE) {
        return { ok: false, reason: `property ${key} must be a number in [0, ${MAX_NUMERIC_VALUE}]` };
      }
    }
    canonicalProperties[key] = value as string | number | boolean;
  }

  return {
    ok: true,
    event: {
      name: e.name,
      tenantId: e.tenantId,
      moduleKey: e.moduleKey,
      moduleVersion: e.moduleVersion,
      occurredAt: e.occurredAt,
      properties: canonicalProperties,
    },
  };
}

export { traceSpan } from "./tracing";
