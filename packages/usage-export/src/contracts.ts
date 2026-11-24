export interface UsageExportEntry {
  readonly eventId: string;
  readonly tenantId: string;
  readonly metricId: string;
  readonly quantity: number;
  readonly occurredAt: string;
}

export interface UsageCloudEvent {
  readonly specversion: "1.0";
  readonly id: string;
  readonly source: "urn:opentenant:usage-ledger";
  readonly type: string;
  readonly subject: string;
  readonly time: string;
  readonly datacontenttype: "application/json";
  readonly data: { readonly quantity: number };
}

export interface UsageExportSink {
  /** Stable name bound to one destination. Change it when changing destinations. */
  readonly id: string;
  /** Acknowledges the entire batch or throws. Replays use identical event IDs. */
  emit(events: readonly UsageCloudEvent[]): Promise<void>;
}

export class UsageExportError extends Error {
  constructor(readonly retryable = false) { super("Usage export failed"); }
}

export function usageCloudEvent(entry: UsageExportEntry): UsageCloudEvent {
  if (!/^[0-9a-f]{32}$/.test(entry.eventId) || !/^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/.test(entry.metricId)
    || entry.metricId.length > 64 || !entry.tenantId || entry.tenantId.length > 128
    || !Number.isSafeInteger(entry.quantity) || entry.quantity === 0
    || !Number.isFinite(Date.parse(entry.occurredAt))) throw new UsageExportError();
  // Explicit projection: no source reference, fingerprint, reason or tenant content.
  return { specversion: "1.0", id: entry.eventId, source: "urn:opentenant:usage-ledger", type: entry.metricId, subject: entry.tenantId, time: new Date(entry.occurredAt).toISOString(), datacontenttype: "application/json", data: { quantity: entry.quantity } };
}
