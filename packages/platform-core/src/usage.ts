export const MAX_USAGE_METRICS = 64;
export const MAX_USAGE_AGGREGATE_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;

export interface UsageMetricDefinition {
  readonly metricId: string;
  readonly unit: string;
  readonly description: string;
}

export interface ExactUsageEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly metricId: string;
  readonly quantity: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly sourceReference: string;
  readonly fingerprint: string;
  readonly idempotencyKey: string | null;
  readonly correctionOfEventId: string | null;
  readonly correctionReason: string | null;
}

export interface UsageMetricRegistry {
  require(metricId: string): UsageMetricDefinition;
  readonly definitions: readonly UsageMetricDefinition[];
}

export interface ExactUsageWindow { readonly start: string; readonly end: string }

const bounded = (value: unknown, maximum: number) => typeof value === "string" && value.length > 0
  && value.length <= maximum && value === value.trim() && /^[\x20-\x7e]+$/.test(value);
const metricId = (value: unknown) => bounded(value, 64) && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value as string);

export function createUsageMetricRegistry(raw: readonly UsageMetricDefinition[]): UsageMetricRegistry {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_USAGE_METRICS) throw new Error("invalid usage metric catalogue");
  const definitions = raw.map((entry) => {
    if (!entry || Object.keys(entry).length !== 3 || !metricId(entry.metricId)
      || !bounded(entry.unit, 64) || !bounded(entry.description, 256)) throw new Error("invalid usage metric definition");
    return Object.freeze({ ...entry });
  });
  const byId = new Map(definitions.map((entry) => [entry.metricId, entry]));
  if (byId.size !== definitions.length) throw new Error("duplicate usage metric definition");
  const frozen = Object.freeze(definitions.slice());
  return Object.freeze({
    definitions: frozen,
    require(id: string) {
      const definition = metricId(id) ? byId.get(id) : undefined;
      if (!definition) throw new Error("unregistered usage metric");
      return definition;
    },
  });
}

export function validateExactUsageWindow(window: ExactUsageWindow): ExactUsageWindow {
  if (!window || Object.keys(window).length !== 2) throw new Error("invalid usage window");
  const start = Date.parse(window.start); const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString() !== window.start
    || new Date(end).toISOString() !== window.end || end <= start || end - start > MAX_USAGE_AGGREGATE_WINDOW_MS) {
    throw new Error("invalid usage window");
  }
  return Object.freeze({ start: window.start, end: window.end });
}
