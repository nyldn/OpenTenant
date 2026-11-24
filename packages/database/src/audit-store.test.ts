import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { canonicalJsonStringify, type AuditActor, type AuditEvent } from "@opentenant/security";
import { PgAuditStore } from "./audit-store";

interface StoredAuditRow {
  sequence: string;
  tenant_id: string | null;
  occurred_at: Date;
  actor: AuditActor;
  action: string;
  subject: string;
  detail: Readonly<Record<string, string | number | boolean | null>>;
  previous_hash: string;
  hash: string;
}

interface Statement {
  sql: string;
  params: ReadonlyArray<unknown>;
  source: "client" | "pool";
}

class FakeAuditDatabase {
  readonly rows: StoredAuditRow[] = [];
  readonly statements: Statement[] = [];
  connections = 0;
  releases = 0;
  failInsert = false;
  failRollback = false;

  asPool(): Pool {
    return {
      connect: async () => {
        this.connections += 1;
        return this.asClient();
      },
      query: async (sql: string, params: ReadonlyArray<unknown> = []) =>
        this.execute(sql, params, "pool"),
    } as unknown as Pool;
  }

  asClient(): PoolClient {
    return {
      query: async (sql: string, params: ReadonlyArray<unknown> = []) =>
        this.execute(sql, params, "client"),
      release: () => {
        this.releases += 1;
      },
    } as unknown as PoolClient;
  }

  private async execute(
    sql: string,
    params: ReadonlyArray<unknown>,
    source: Statement["source"],
  ): Promise<{ rows: unknown[] }> {
    this.statements.push({ sql, params, source });

    if (sql === "rollback" && this.failRollback) {
      throw new Error("rollback failed");
    }
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [] };
    }
    if (sql.startsWith("select pg_advisory_xact_lock")) {
      return { rows: [] };
    }
    if (sql.startsWith("select sequence, hash from audit_events")) {
      const tenantId = params[0] as string | null;
      const tail = [...this.rows]
        .filter((row) => row.tenant_id === tenantId)
        .sort((a, b) => Number(b.sequence) - Number(a.sequence))[0];
      return {
        rows: tail ? [{ sequence: tail.sequence, hash: tail.hash }] : [],
      };
    }
    if (sql.includes("insert into audit_events")) {
      if (this.failInsert) throw new Error("insert failed");
      this.rows.push({
        sequence: String(params[0]),
        tenant_id: params[1] as string | null,
        occurred_at: params[2] as Date,
        actor: JSON.parse(String(params[3])) as AuditActor,
        action: String(params[4]),
        subject: String(params[5]),
        detail: JSON.parse(String(params[6])) as StoredAuditRow["detail"],
        previous_hash: String(params[7]),
        hash: String(params[8]),
      });
      return { rows: [] };
    }
    if (sql.includes("where tenant_id = $1 order by sequence desc")) {
      const tenantId = String(params[0]);
      const limit = Number(params[1]);
      return {
        rows: [...this.rows]
          .filter((row) => row.tenant_id === tenantId)
          .sort((a, b) => Number(b.sequence) - Number(a.sequence))
          .slice(0, limit),
      };
    }
    if (sql.includes("order by occurred_at desc, tenant_id, sequence desc limit $1")) {
      const limit = Number(params[0]);
      return {
        rows: [...this.rows]
          .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime())
          .slice(0, limit),
      };
    }
    if (sql.includes("where tenant_id is not distinct from $1 order by sequence asc")) {
      const tenantId = params[0] as string | null;
      return {
        rows: [...this.rows]
          .filter((row) => row.tenant_id === tenantId)
          .sort((a, b) => Number(a.sequence) - Number(b.sequence)),
      };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

const baseEvent = {
  tenantId: "tenant_alpha",
  occurredAt: new Date("2026-07-20T10:00:00.000Z"),
  actor: { kind: "user", userId: "user_1" } as const,
  action: "tenant.update",
  subject: "tenant_alpha",
  detail: { setting: "navigation" },
};

function storedRow(
  sequence: number,
  previousHash: string,
  overrides: Partial<Omit<AuditEvent, "sequence" | "previousHash" | "hash">> = {},
): StoredAuditRow {
  const event = { ...baseEvent, ...overrides, sequence };
  const input = canonicalJsonStringify({
    previousHash,
    sequence,
    tenantId: event.tenantId,
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actor,
    action: event.action,
    subject: event.subject,
    detail: event.detail,
  });
  if (input === undefined) throw new TypeError("Audit test hash input could not be serialized");
  const hash = createHash("sha256").update(input).digest("hex");
  return {
    sequence: String(sequence),
    tenant_id: event.tenantId,
    occurred_at: event.occurredAt,
    actor: event.actor,
    action: event.action,
    subject: event.subject,
    detail: event.detail,
    previous_hash: previousHash,
    hash,
  };
}

function legacyStoredRow(
  sequence: number,
  previousHash: string,
  overrides: Partial<Omit<AuditEvent, "sequence" | "previousHash" | "hash">> = {},
): StoredAuditRow {
  const event = { ...baseEvent, ...overrides, sequence };
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        previousHash,
        sequence,
        occurredAt: event.occurredAt.toISOString(),
        actor: event.actor,
        action: event.action,
        subject: event.subject,
        detail: event.detail,
      }),
    )
    .digest("hex");
  return {
    sequence: String(sequence),
    tenant_id: event.tenantId,
    occurred_at: event.occurredAt,
    actor: event.actor,
    action: event.action,
    subject: event.subject,
    detail: event.detail,
    previous_hash: previousHash,
    hash,
  };
}

describe("PgAuditStore", () => {
  it("appends a genesis event and chains the next event", async () => {
    const database = new FakeAuditDatabase();
    const store = new PgAuditStore(database.asPool());

    const first = await store.append(baseEvent);
    const second = await store.append({
      ...baseEvent,
      occurredAt: new Date("2026-07-20T10:05:00.000Z"),
      action: "tenant.activate",
    });

    expect(first.sequence).toBe(1);
    expect(first.previousHash).toBe("genesis");
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
    expect(await store.verifyChain("tenant_alpha")).toEqual({
      intact: true,
      brokenAtSequence: null,
      assurance: "canonical",
      canonicalFromSequence: 1,
      failure: null,
    });
  });

  it("serializes tenant and platform scopes with distinct advisory-lock keys", async () => {
    const database = new FakeAuditDatabase();
    const store = new PgAuditStore(database.asPool());
    const client = database.asClient();

    await store.appendWithClient(client, baseEvent);
    await store.appendWithClient(client, { ...baseEvent, tenantId: "tenant_beta" });
    await store.appendWithClient(client, { ...baseEvent, tenantId: null });

    const lockParams = database.statements
      .filter(({ sql }) => sql.startsWith("select pg_advisory_xact_lock"))
      .map(({ params }) => params);
    expect(lockParams).toEqual([["tenant_alpha"], ["tenant_beta"], ["__platform__"]]);
  });

  it("owns and completes the append transaction", async () => {
    const database = new FakeAuditDatabase();
    const store = new PgAuditStore(database.asPool());

    await store.append(baseEvent);

    expect(database.connections).toBe(1);
    expect(database.releases).toBe(1);
    expect(database.statements.map(({ sql }) => sql)).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1))",
      "select sequence, hash from audit_events where tenant_id is not distinct from $1 order by sequence desc limit 1",
      expect.stringContaining("insert into audit_events"),
      "commit",
    ]);
  });

  it("rolls back and releases the client when insertion fails", async () => {
    const database = new FakeAuditDatabase();
    database.failInsert = true;
    const store = new PgAuditStore(database.asPool());

    await expect(store.append(baseEvent)).rejects.toThrow("insert failed");

    expect(database.statements.map(({ sql }) => sql)).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1))",
      "select sequence, hash from audit_events where tenant_id is not distinct from $1 order by sequence desc limit 1",
      expect.stringContaining("insert into audit_events"),
      "rollback",
    ]);
    expect(database.releases).toBe(1);
  });

  it("preserves the insert error and releases the client when rollback also fails", async () => {
    const database = new FakeAuditDatabase();
    database.failInsert = true;
    database.failRollback = true;
    const store = new PgAuditStore(database.asPool());

    await expect(store.append(baseEvent)).rejects.toThrow("insert failed");

    expect(database.statements.at(-1)?.sql).toBe("rollback");
    expect(database.releases).toBe(1);
  });

  it("leaves transaction ownership with appendWithClient callers", async () => {
    const database = new FakeAuditDatabase();
    const store = new PgAuditStore(database.asPool());

    const event = await store.appendWithClient(database.asClient(), baseEvent);

    expect(event.sequence).toBe(1);
    expect(database.connections).toBe(0);
    expect(database.releases).toBe(0);
    expect(database.statements.map(({ sql }) => sql)).not.toContain("begin");
    expect(database.statements.map(({ sql }) => sql)).not.toContain("commit");
    expect(database.statements.map(({ sql }) => sql)).not.toContain("rollback");
  });

  it("maps tenant rows and clamps list limits to the supported range", async () => {
    const database = new FakeAuditDatabase();
    const row = storedRow(1, "genesis");
    database.rows.push(row);
    const store = new PgAuditStore(database.asPool());

    const tenantEvents = await store.listForTenant("tenant_alpha", 0);
    const recentEvents = await store.listRecent(999);
    await store.listForTenant("tenant_alpha", 999);
    await store.listRecent(0);

    expect(tenantEvents).toEqual([
      {
        sequence: 1,
        tenantId: "tenant_alpha",
        occurredAt: new Date("2026-07-20T10:00:00.000Z"),
        actor: { kind: "user", userId: "user_1" },
        action: "tenant.update",
        subject: "tenant_alpha",
        detail: { setting: "navigation" },
        previousHash: "genesis",
        hash: row.hash,
      },
    ]);
    expect(recentEvents).toEqual(tenantEvents);
    const listParams = database.statements
      .filter(({ source }) => source === "pool")
      .map(({ params }) => params);
    expect(listParams).toEqual([
      ["tenant_alpha", 1],
      [500],
      ["tenant_alpha", 500],
      [1],
    ]);
  });

  it("accepts an empty chain and verifies an intact chain", async () => {
    const database = new FakeAuditDatabase();
    const store = new PgAuditStore(database.asPool());

    expect(await store.verifyChain("tenant_alpha")).toEqual({
      intact: true,
      brokenAtSequence: null,
      assurance: "empty",
      canonicalFromSequence: null,
      failure: null,
    });
    const first = storedRow(1, "genesis");
    const second = storedRow(2, first.hash, {
      occurredAt: new Date("2026-07-20T10:05:00.000Z"),
      action: "tenant.activate",
    });
    database.rows.push(first, second);

    expect(await store.verifyChain("tenant_alpha")).toEqual({
      intact: true,
      brokenAtSequence: null,
      assurance: "canonical",
      canonicalFromSequence: 1,
      failure: null,
    });
  });

  it("verifies a chain after jsonb reorders actor and detail object keys", async () => {
    const database = new FakeAuditDatabase();
    const store = new PgAuditStore(database.asPool());
    await store.append({
      ...baseEvent,
      detail: { setting: "navigation", enabled: true },
    });
    const stored = database.rows[0]!;
    stored.actor = { userId: "user_1", kind: "user" };
    stored.detail = { enabled: true, setting: "navigation" };

    expect(await store.verifyChain("tenant_alpha")).toEqual({
      intact: true,
      brokenAtSequence: null,
      assurance: "canonical",
      canonicalFromSequence: 1,
      failure: null,
    });
  });

  it("verifies an independently computed legacy JSON.stringify digest", async () => {
    const database = new FakeAuditDatabase();
    database.rows.push(legacyStoredRow(1, "genesis"));
    const store = new PgAuditStore(database.asPool());

    expect(await store.verifyChain("tenant_alpha")).toMatchObject({
      intact: true,
      assurance: "legacy-unbound",
      canonicalFromSequence: null,
      failure: null,
    });
  });

  it("verifies a legacy event followed by a canonical event", async () => {
    const database = new FakeAuditDatabase();
    const legacy = legacyStoredRow(1, "genesis");
    const canonical = storedRow(2, legacy.hash, {
      occurredAt: new Date("2026-07-20T10:05:00.000Z"),
      action: "tenant.activate",
    });
    database.rows.push(legacy, canonical);
    const store = new PgAuditStore(database.asPool());

    expect(await store.verifyChain("tenant_alpha")).toMatchObject({
      intact: true,
      assurance: "legacy-unbound",
      canonicalFromSequence: 2,
      failure: null,
    });
  });

  it("rejects a legacy hash-format downgrade after canonical evidence", async () => {
    const database = new FakeAuditDatabase();
    const canonical = storedRow(1, "genesis");
    const legacy = legacyStoredRow(2, canonical.hash, {
      occurredAt: new Date("2026-07-20T10:05:00.000Z"),
      action: "tenant.activate",
    });
    database.rows.push(canonical, legacy);
    const store = new PgAuditStore(database.asPool());

    expect(await store.verifyChain("tenant_alpha")).toMatchObject({
      intact: false,
      brokenAtSequence: 2,
      assurance: "unverified",
      canonicalFromSequence: 1,
      failure: "format_downgrade",
    });
  });

  it("rejects a new canonical event whose tenant scope is changed", async () => {
    const database = new FakeAuditDatabase();
    const store = new PgAuditStore(database.asPool());
    await store.append(baseEvent);
    database.rows[0]!.tenant_id = "tenant_beta";

    expect(await store.verifyChain("tenant_beta")).toEqual({
      intact: false,
      brokenAtSequence: 1,
      assurance: "unverified",
      canonicalFromSequence: null,
      failure: "hash_mismatch",
    });
  });

  it.each([
    ["content", { action: "tenant.tampered" }],
    ["hash", { hash: "0".repeat(64) }],
  ])("detects %s tampering", async (_kind, tamper) => {
    const database = new FakeAuditDatabase();
    const first = storedRow(1, "genesis");
    const second = storedRow(2, first.hash);
    database.rows.push(first, { ...second, ...tamper });
    const store = new PgAuditStore(database.asPool());

    expect(await store.verifyChain("tenant_alpha")).toEqual({
      intact: false,
      brokenAtSequence: 2,
      assurance: "unverified",
      canonicalFromSequence: 1,
      failure: "hash_mismatch",
    });
  });

  it("rejects a self-consistent chain whose first sequence is missing", async () => {
    const database = new FakeAuditDatabase();
    database.rows.push(storedRow(2, "genesis"));
    const store = new PgAuditStore(database.asPool());

    expect(await store.verifyChain("tenant_alpha")).toEqual({
      intact: false,
      brokenAtSequence: 2,
      assurance: "unverified",
      canonicalFromSequence: null,
      failure: "sequence_gap",
    });
  });

  it("rejects a self-consistent chain with an intermediate sequence gap", async () => {
    const database = new FakeAuditDatabase();
    const first = storedRow(1, "genesis");
    database.rows.push(first, storedRow(3, first.hash));
    const store = new PgAuditStore(database.asPool());

    expect(await store.verifyChain("tenant_alpha")).toEqual({
      intact: false,
      brokenAtSequence: 3,
      assurance: "unverified",
      canonicalFromSequence: 1,
      failure: "sequence_gap",
    });
  });

  it("binds tenant and platform verification queries to their exact scopes", async () => {
    const database = new FakeAuditDatabase();
    database.rows.push(
      storedRow(1, "genesis"),
      storedRow(1, "genesis", {
        tenantId: null,
        actor: { kind: "system", job: "platform-maintenance" },
        subject: "platform",
      }),
    );
    const store = new PgAuditStore(database.asPool());

    expect((await store.verifyChain("tenant_alpha")).intact).toBe(true);
    expect((await store.verifyChain(null)).intact).toBe(true);
    const verificationParams = database.statements
      .filter(({ sql }) => sql.includes("order by sequence asc"))
      .map(({ params }) => params);
    expect(verificationParams).toEqual([["tenant_alpha"], [null]]);
  });
});
