import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import type { AuditActor } from "@opentenant/security";
import { PgHelpdeskProjectionStore, type HelpdeskProjectionEvent } from "./index";

const actor: AuditActor = { kind: "installation_owner", userId: "user_owner" } as AuditActor;

function harness(rowsFor: (sql: string) => unknown[] = () => []) {
  const query = vi.fn(async (sql: string, _params?: readonly unknown[]) => ({
    rows: rowsFor(sql),
    rowCount: rowsFor(sql).length,
  }) as QueryResult);
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, query, release };
}

function event(overrides: Partial<HelpdeskProjectionEvent> = {}): HelpdeskProjectionEvent {
  return {
    eventId: 7,
    tenantId: "ten_a",
    ticketNumber: "SUP-000001",
    ticketVersion: 3,
    kind: "status_change",
    status: "in_progress",
    priority: "high",
    category: "bug_report",
    assignedRef: "user_2",
    openedAt: "2026-07-27T09:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z",
    occurredAt: "2026-07-27T10:00:00.000Z",
    ...overrides,
  };
}

describe("PgHelpdeskProjectionStore.applyEvent", () => {
  it("applies monotonically by canonical ticket version", async () => {
    const h = harness((sql) =>
      sql.includes("insert into helpdesk_ticket_projection") ? [{ source_version: "3" }] : [],
    );
    const store = new PgHelpdeskProjectionStore(h.pool);
    await expect(store.applyEvent(event())).resolves.toBe("applied");
    const upsert = h.query.mock.calls.find(([sql]) =>
      sql.includes("insert into helpdesk_ticket_projection"),
    );
    expect(upsert?.[0]).toContain(
      "excluded.source_version > helpdesk_ticket_projection.source_version",
    );
  });

  it("reports a stale event without replacing a newer row", async () => {
    const h = harness(() => []);
    const store = new PgHelpdeskProjectionStore(h.pool);
    await expect(store.applyEvent(event({ ticketVersion: 1 }))).resolves.toBe("stale");
  });

  it("rejects malformed envelopes without touching projection rows", async () => {
    const h = harness();
    const store = new PgHelpdeskProjectionStore(h.pool);
    await expect(store.applyEvent(event({ status: "weird" }))).resolves.toBe("rejected");
    await expect(store.applyEvent(event({ ticketVersion: 0 }))).resolves.toBe("rejected");
    await expect(store.applyEvent(event({ priority: "asap" }))).resolves.toBe("rejected");
    expect(
      h.query.mock.calls.some(([sql]) => sql.includes("insert into helpdesk_ticket_projection")),
    ).toBe(false);
    // Health captured the rejection reason.
    expect(
      h.query.mock.calls.some(([sql]) => sql.includes("helpdesk_projection_state")),
    ).toBe(true);
  });

  it("rejects an envelope smuggling content keys", async () => {
    const h = harness();
    const store = new PgHelpdeskProjectionStore(h.pool);
    const smuggled = { ...event(), subject: "secret" } as HelpdeskProjectionEvent;
    await expect(store.applyEvent(smuggled)).resolves.toBe("rejected");
  });

  it("marks tombstone events as tombstoned rows", async () => {
    const h = harness((sql) =>
      sql.includes("insert into helpdesk_ticket_projection") ? [{ source_version: "4" }] : [],
    );
    const store = new PgHelpdeskProjectionStore(h.pool);
    await store.applyEvent(event({ kind: "tombstone", ticketVersion: 4 }));
    const upsert = h.query.mock.calls.find(([sql]) =>
      sql.includes("insert into helpdesk_ticket_projection"),
    );
    expect(upsert?.[1]?.at(-1)).toBe(true);
  });

  it("applies batches in ascending event-id order", async () => {
    const applied: number[] = [];
    const h = harness((sql) => {
      if (sql.includes("insert into helpdesk_ticket_projection")) return [{ source_version: "1" }];
      return [];
    });
    const store = new PgHelpdeskProjectionStore(h.pool);
    h.query.mockImplementation(async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes("insert into helpdesk_ticket_projection")) {
        applied.push(Number(params?.[9]));
        return { rows: [{ source_version: "1" }], rowCount: 1 } as unknown as QueryResult;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
    await store.applyEvents([
      event({ eventId: 9, ticketVersion: 2 }),
      event({ eventId: 3, ticketVersion: 1 }),
    ]);
    expect(applied).toEqual([3, 9]);
  });
});

describe("PgHelpdeskProjectionStore queue seam", () => {
  it("hides tombstoned rows and clamps the limit", async () => {
    const h = harness(() => []);
    const store = new PgHelpdeskProjectionStore(h.pool);
    await store.listQueue({ limit: 100_000 });
    const [sql, params] = h.query.mock.calls[0]!;
    expect(sql).toContain("tombstoned = false");
    expect(params?.at(-1)).toBe(100);
    expect(sql).not.toMatch(/subject|body|description/iu);
  });

  it("fails closed on an unknown filter value instead of interpolating it", async () => {
    const h = harness(() => []);
    const store = new PgHelpdeskProjectionStore(h.pool);
    await expect(store.listQueue({ status: "'; drop table tickets; --" })).resolves.toEqual([]);
    expect(h.query).not.toHaveBeenCalled();
  });
});

describe("PgHelpdeskProjectionStore administrative actions", () => {
  it("tombstones a tenant and audits the action in the same transaction", async () => {
    const h = harness((sql) => {
      if (sql.includes("update helpdesk_ticket_projection")) {
        return [{ ticket_number: "SUP-000001" }, { ticket_number: "SUP-000002" }];
      }
      return [];
    });
    const store = new PgHelpdeskProjectionStore(h.pool);
    await expect(
      store.tombstoneTenant({ tenantId: "ten_a", actor, reason: "module_disabled" }),
    ).resolves.toBe(2);
    const statements = h.query.mock.calls.map(([sql]) => sql);
    const tombstoneIndex = statements.findIndex((sql) =>
      sql.includes("update helpdesk_ticket_projection"),
    );
    const auditIndex = statements.findIndex((sql) => sql.includes("insert into audit_events"));
    const commitIndex = statements.findIndex((sql) => sql === "commit");
    expect(tombstoneIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(tombstoneIndex);
    expect(commitIndex).toBeGreaterThan(auditIndex);
  });

  it("rebuilds from canonical rows atomically with checkpoint and audit", async () => {
    const h = harness(() => []);
    const store = new PgHelpdeskProjectionStore(h.pool);
    const result = await store.rebuildForTenant({
      tenantId: "ten_a",
      actor,
      latestEventId: 42,
      rows: [
        {
          tenantId: "ten_a",
          ticketNumber: "SUP-000001",
          ticketVersion: 5,
          status: "open",
          priority: "medium",
          category: "other",
          assignedRef: null,
          openedAt: "2026-07-27T09:00:00.000Z",
          updatedAt: "2026-07-27T10:00:00.000Z",
        },
        {
          tenantId: "ten_a",
          ticketNumber: "SUP-000002",
          ticketVersion: 1,
          status: "nonsense",
          priority: "medium",
          category: "other",
          assignedRef: null,
          openedAt: "2026-07-27T09:00:00.000Z",
          updatedAt: "2026-07-27T10:00:00.000Z",
        },
      ],
    });
    expect(result).toEqual({ rebuilt: 1, rejected: 1 });
    const statements = h.query.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => sql.includes("delete from helpdesk_ticket_projection"))).toBe(
      true,
    );
    expect(statements.some((sql) => sql.includes("insert into audit_events"))).toBe(true);
    expect(statements.filter((sql) => sql === "begin")).toHaveLength(1);
  });
});
