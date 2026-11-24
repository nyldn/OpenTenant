import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { AuditActor } from "@opentenant/security";
import { PgAuditStore } from "./audit-store";
import { PgHelpdeskProjectionStore, type HelpdeskProjectionEvent } from "./helpdesk-projection-store";

const integrationUrl = process.env.HELPDESK_INTEGRATION_DATABASE_URL;
const describeIntegration = integrationUrl ? describe : describe.skip;

const actor: AuditActor = { kind: "installation_owner", userId: "user_owner" } as AuditActor;

async function controlPlaneMigrations(): Promise<Array<{ id: string; sql: string }>> {
  const directory = join(
    dirname(fileURLToPath(import.meta.url)),
    "..", "..", "..", "tooling", "migrations", "sql", "control-plane",
  );
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(names.map(async (name) => ({
    id: name.replace(/\.sql$/u, ""),
    sql: await readFile(join(directory, name), "utf8"),
  })));
}

function event(overrides: Partial<HelpdeskProjectionEvent> = {}): HelpdeskProjectionEvent {
  return {
    eventId: 1,
    tenantId: "ten_alpha",
    ticketNumber: "SUP-000001",
    ticketVersion: 1,
    kind: "created",
    status: "open",
    priority: "medium",
    category: "other",
    assignedRef: null,
    openedAt: "2026-07-27T09:00:00.000Z",
    updatedAt: "2026-07-27T09:00:00.000Z",
    occurredAt: "2026-07-27T09:00:00.000Z",
    ...overrides,
  };
}

describeIntegration("PgHelpdeskProjectionStore against PostgreSQL", () => {
  if (!integrationUrl) return;
  const parsed = new URL(integrationUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || !parsed.pathname.slice(1).startsWith("opentenant_ops06_")
  ) {
    throw new Error("helpdesk projection tests require an opentenant_ops06_ loopback database");
  }
  const pool = new Pool({ connectionString: integrationUrl, max: 2 });

  beforeEach(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    for (const migration of await controlPlaneMigrations()) {
      await pool.query("begin");
      try {
        await pool.query(migration.sql);
        await pool.query("commit");
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
    }
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ('ten_alpha', 'alpha', 'Alpha', 'active', 'us'),
              ('ten_beta', 'beta', 'Beta', 'active', 'us')`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("applies, replays idempotently, and refuses to regress a newer row", async () => {
    const store = new PgHelpdeskProjectionStore(pool);
    await expect(store.applyEvent(event())).resolves.toBe("applied");
    await expect(
      store.applyEvent(event({ eventId: 2, ticketVersion: 3, status: "resolved" })),
    ).resolves.toBe("applied");
    // Replay of an older event cannot replace the newer row.
    await expect(
      store.applyEvent(event({ eventId: 1, ticketVersion: 1 })),
    ).resolves.toBe("stale");
    const rows = await store.listQueue({ tenantId: "ten_alpha" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "resolved", sourceVersion: 3 });
    const health = await store.health("ten_alpha");
    expect(health[0]!.lastEventId).toBe(2);
  });

  it("hides tombstoned rows from the queue without deleting canonical anything", async () => {
    const store = new PgHelpdeskProjectionStore(pool);
    await store.applyEvent(event());
    await store.applyEvent(event({ eventId: 2, ticketVersion: 2, kind: "tombstone" }));
    await expect(store.listQueue({ tenantId: "ten_alpha" })).resolves.toEqual([]);
  });

  it("keeps tenants isolated in queue reads", async () => {
    const store = new PgHelpdeskProjectionStore(pool);
    await store.applyEvent(event());
    await store.applyEvent(
      event({ tenantId: "ten_beta", ticketNumber: "SUP-000001", eventId: 1 }),
    );
    const alpha = await store.listQueue({ tenantId: "ten_alpha" });
    expect(alpha).toHaveLength(1);
    expect(alpha.every((row) => row.tenantId === "ten_alpha")).toBe(true);
  });

  it("tombstones a tenant and appends verifiable audit evidence atomically", async () => {
    const store = new PgHelpdeskProjectionStore(pool);
    await store.applyEvent(event());
    await expect(
      store.tombstoneTenant({ tenantId: "ten_alpha", actor, reason: "module_disabled" }),
    ).resolves.toBe(1);
    await expect(store.listQueue({ tenantId: "ten_alpha" })).resolves.toEqual([]);
    const audit = new PgAuditStore(pool);
    const verification = await audit.verifyChain("ten_alpha");
    expect(verification.intact).toBe(true);
    const events = await audit.listForTenant("ten_alpha", 10);
    expect(events.some((entry) => entry.action === "helpdesk.projection.tombstone_tenant")).toBe(
      true,
    );
  });

  it("rebuilds from canonical rows and re-baselines the checkpoint", async () => {
    const store = new PgHelpdeskProjectionStore(pool);
    await store.applyEvent(event({ eventId: 5, ticketVersion: 2, status: "closed" }));
    await store.tombstoneTenant({ tenantId: "ten_alpha", actor, reason: "retention" });
    const result = await store.rebuildForTenant({
      tenantId: "ten_alpha",
      actor,
      latestEventId: 9,
      rows: [
        {
          tenantId: "ten_alpha",
          ticketNumber: "SUP-000001",
          ticketVersion: 4,
          status: "open",
          priority: "high",
          category: "billing",
          assignedRef: "user_2",
          openedAt: "2026-07-27T09:00:00.000Z",
          updatedAt: "2026-07-27T11:00:00.000Z",
        },
      ],
    });
    expect(result).toEqual({ rebuilt: 1, rejected: 0 });
    const rows = await store.listQueue({ tenantId: "ten_alpha" });
    expect(rows[0]).toMatchObject({ sourceVersion: 4, priority: "high", tombstoned: false });
    const health = await store.health("ten_alpha");
    expect(health[0]!.lastEventId).toBe(9);
    expect(health[0]!.lastRebuildAt).not.toBeNull();
  });

  it("never regresses a row applied concurrently after the rebuild's canonical read", async () => {
    const store = new PgHelpdeskProjectionStore(pool);
    // Simulates: rebuild read canonical state at version 10 / checkpoint 50,
    // then a live pass applied version 11 from outbox event 51 first.
    await store.applyEvent(
      event({ eventId: 51, ticketVersion: 11, status: "resolved" }),
    );
    // A ticket that vanished canonically before the checkpoint...
    await store.applyEvent(
      event({ eventId: 40, ticketNumber: "SUP-000002", ticketVersion: 2 }),
    );
    // ...and one projected from an event past the rebuild checkpoint.
    await store.applyEvent(
      event({ eventId: 60, ticketNumber: "SUP-000003", ticketVersion: 1 }),
    );
    await store.rebuildForTenant({
      tenantId: "ten_alpha",
      actor,
      latestEventId: 50,
      rows: [
        {
          tenantId: "ten_alpha",
          ticketNumber: "SUP-000001",
          ticketVersion: 10,
          status: "open",
          priority: "medium",
          category: "other",
          assignedRef: null,
          openedAt: "2026-07-27T09:00:00.000Z",
          updatedAt: "2026-07-27T10:00:00.000Z",
        },
      ],
    });
    const rows = await store.listQueue({ tenantId: "ten_alpha" });
    const byNumber = new Map(rows.map((row) => [row.ticketNumber, row]));
    // The concurrently applied newer row survives at version 11.
    expect(byNumber.get("SUP-000001")).toMatchObject({ sourceVersion: 11, status: "resolved" });
    // The canonically purged pre-checkpoint row is removed.
    expect(byNumber.has("SUP-000002")).toBe(false);
    // The post-checkpoint concurrent row is preserved.
    expect(byNumber.has("SUP-000003")).toBe(true);
  });

  it("has no content columns to leak", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'helpdesk_ticket_projection'`,
    );
    const columns = rows.map((row) => row.column_name);
    for (const denied of ["subject", "body", "description", "message"]) {
      expect(columns).not.toContain(denied);
    }
  });
});
