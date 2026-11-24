import { describe, expect, it } from "vitest";
import {
  executeConnectorBatch,
  type ConnectorCursorStore,
  type QuarantineWriter,
  type SourceConnector,
} from "./source-connector";

interface RawMessage {
  id: string;
  ok: boolean;
}

describe("executeConnectorBatch", () => {
  it("resumes from the saved cursor, persists the batch, then advances the cursor", async () => {
    const order: string[] = [];
    const saves: Array<string | null> = [];
    const cursorStore: ConnectorCursorStore = {
      async load() {
        return "cursor_1";
      },
      async save(_tenantId, _source, cursor) {
        order.push("cursor");
        saves.push(cursor);
      },
    };
    const quarantine: QuarantineWriter<RawMessage> = {
      async write() {
        throw new Error("quarantine should not be used");
      },
    };
    const connector: SourceConnector<RawMessage> = {
      source: "slack",
      async fetchBatch({ cursor }) {
        expect(cursor).toBe("cursor_1");
        return {
          records: [{ id: "m_1", ok: true }],
          nextCursor: "cursor_2",
          hasMore: false,
        };
      },
      async normalize(record) {
        return {
          sourceId: record.id,
          observedAt: new Date("2026-07-17T00:00:00.000Z"),
          visibility: "internal",
          contentHash: `hash:${record.id}`,
          provenance: { source: "slack" },
          payloadText: "normalized payload",
        };
      },
    };

    const result = await executeConnectorBatch({
      tenantId: "tenant_brain",
      connector,
      cursorStore,
      quarantine,
      async persist(normalized) {
        order.push("persist");
        expect(normalized).toHaveLength(1);
      },
      maxItems: 50,
    });

    expect(result.resumedFrom).toBe("cursor_1");
    expect(result.nextCursor).toBe("cursor_2");
    expect(result.normalized).toHaveLength(1);
    expect(saves).toEqual(["cursor_2"]);
    expect(order).toEqual(["persist", "cursor"]);
  });

  it("quarantines records that fail normalization and continues the batch", async () => {
    const quarantined: RawMessage[] = [];
    const cursorStore: ConnectorCursorStore = {
      async load() {
        return null;
      },
      async save() {},
    };
    const quarantine: QuarantineWriter<RawMessage> = {
      async write(event) {
        quarantined.push(event.rawRecord);
      },
    };
    const connector: SourceConnector<RawMessage> = {
      source: "gmail",
      async fetchBatch() {
        return {
          records: [
            { id: "good", ok: true },
            { id: "bad", ok: false },
          ],
          nextCursor: "cursor_3",
          hasMore: true,
        };
      },
      async normalize(record) {
        if (!record.ok) throw new Error("normalization_failed");
        return {
          sourceId: record.id,
          observedAt: null,
          visibility: "private",
          contentHash: `hash:${record.id}`,
          provenance: { source: "gmail" },
          payloadText: "normalized payload",
        };
      },
    };

    const result = await executeConnectorBatch({
      tenantId: "tenant_brain",
      connector,
      cursorStore,
      quarantine,
      async persist() {},
      maxItems: 50,
    });

    expect(result.normalized).toHaveLength(1);
    expect(result.quarantined).toBe(1);
    expect(quarantined).toEqual([{ id: "bad", ok: false }]);
  });
});
