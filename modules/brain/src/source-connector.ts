import type { RawSignalRecord, Visibility } from "./spine";

export type ConnectorCursor = string | null;

export interface ConnectorFetchInput<TCursor extends ConnectorCursor = ConnectorCursor> {
  tenantId: string;
  cursor: TCursor;
  maxItems: number;
}

export interface ConnectorBatch<TRaw, TCursor extends ConnectorCursor = ConnectorCursor> {
  records: ReadonlyArray<TRaw>;
  nextCursor: TCursor;
  hasMore: boolean;
}

export interface NormalizedSignal {
  sourceId: string;
  observedAt: Date | null;
  visibility: Visibility;
  contentHash: string;
  provenance: Readonly<Record<string, string | number | boolean | null>>;
  payloadText: string;
}

export interface SourceConnector<TRaw, TCursor extends ConnectorCursor = ConnectorCursor> {
  readonly source: string;
  fetchBatch(input: ConnectorFetchInput<TCursor>): Promise<ConnectorBatch<TRaw, TCursor>>;
  normalize(record: TRaw): Promise<NormalizedSignal> | NormalizedSignal;
}

export interface ConnectorCursorStore<TCursor extends ConnectorCursor = ConnectorCursor> {
  load(tenantId: string, source: string): Promise<TCursor>;
  save(tenantId: string, source: string, cursor: TCursor): Promise<void>;
}

export interface QuarantineWriter<TRaw> {
  write(event: {
    tenantId: string;
    source: string;
    cursor: ConnectorCursor;
    rawRecord: TRaw;
    reason: string;
  }): Promise<void>;
}

export interface ConnectorExecutionResult<TCursor extends ConnectorCursor = ConnectorCursor> {
  resumedFrom: TCursor;
  nextCursor: TCursor;
  hasMore: boolean;
  normalized: ReadonlyArray<NormalizedSignal>;
  quarantined: number;
}

export async function executeConnectorBatch<TRaw, TCursor extends ConnectorCursor = ConnectorCursor>(input: {
  tenantId: string;
  connector: SourceConnector<TRaw, TCursor>;
  cursorStore: ConnectorCursorStore<TCursor>;
  quarantine: QuarantineWriter<TRaw>;
  /**
   * Durably persists the batch before the cursor advances. A crash after
   * persist but before the cursor save replays the batch; the raw_signals
   * unique (tenant_id, source, source_id) constraint makes the replay a
   * no-op, so delivery is at-least-once, never at-most-once.
   */
  persist: (normalized: ReadonlyArray<NormalizedSignal>) => Promise<void>;
  maxItems: number;
}): Promise<ConnectorExecutionResult<TCursor>> {
  const cursor = await input.cursorStore.load(input.tenantId, input.connector.source);
  const batch = await input.connector.fetchBatch({
    tenantId: input.tenantId,
    cursor,
    maxItems: input.maxItems,
  });

  const normalized: NormalizedSignal[] = [];
  let quarantined = 0;
  for (const record of batch.records) {
    try {
      normalized.push(await input.connector.normalize(record));
    } catch (error) {
      quarantined += 1;
      await input.quarantine.write({
        tenantId: input.tenantId,
        source: input.connector.source,
        cursor,
        rawRecord: record,
        reason: error instanceof Error ? error.message : "normalization_failed",
      });
    }
  }

  await input.persist(normalized);
  await input.cursorStore.save(input.tenantId, input.connector.source, batch.nextCursor);
  return {
    resumedFrom: cursor,
    nextCursor: batch.nextCursor,
    hasMore: batch.hasMore,
    normalized,
    quarantined,
  };
}

export function toRawSignalRecord(
  tenantId: string,
  source: string,
  normalized: NormalizedSignal,
  now: Date,
): Omit<RawSignalRecord, "id" | "redactedAt"> {
  return {
    tenantId,
    source,
    sourceId: normalized.sourceId,
    observedAt: normalized.observedAt,
    ingestedAt: now,
    visibility: normalized.visibility,
    contentHash: normalized.contentHash,
    provenance: normalized.provenance,
  };
}
