/**
 * Hash-chained audit store against the control-plane audit_events table
 * (spec section 14). Append computes the next sequence and chains the hash;
 * the database's append-only trigger and nulls-not-distinct uniqueness back
 * the tamper resistance.
 */
import type { Pool, PoolClient } from "pg";
import { auditEventHash, verifyAuditEvents } from "@opentenant/security/audit-chain";
import {
  type AuditChainVerification,
  type AuditEvent,
  type AuditReader,
  type AuditWriter,
} from "@opentenant/security";

export class PgAuditStore implements AuditWriter, AuditReader {
  constructor(private readonly pool: Pool) {}

  async append(event: Omit<AuditEvent, "sequence" | "hash" | "previousHash">): Promise<AuditEvent> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const full = await this.appendWithClient(client, event);
      await client.query("commit");
      return full;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async appendWithClient(
    client: PoolClient,
    event: Omit<AuditEvent, "sequence" | "hash" | "previousHash">,
  ): Promise<AuditEvent> {
    // Serialize appends per scope so the chain never forks.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [event.tenantId ?? "__platform__"]);
    const { rows } = await client.query<{ sequence: string; hash: string }>(
      "select sequence, hash from audit_events where tenant_id is not distinct from $1 order by sequence desc limit 1",
      [event.tenantId],
    );
    const previous = rows[0];
    const sequence = previous ? Number(previous.sequence) + 1 : 1;
    const previousHash = previous?.hash ?? "genesis";
    const full: AuditEvent = {
      ...event,
      sequence,
      previousHash,
      hash: auditEventHash(previousHash, { ...event, sequence }),
    };
    await client.query(
      `insert into audit_events (sequence, tenant_id, occurred_at, actor, action, subject, detail, previous_hash, hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        full.sequence,
        full.tenantId,
        full.occurredAt,
        JSON.stringify(full.actor),
        full.action,
        full.subject,
        JSON.stringify(full.detail),
        full.previousHash,
        full.hash,
      ],
    );
    return full;
  }

  async listForTenant(tenantId: string, limit: number): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query(
      `select sequence, tenant_id, occurred_at, actor, action, subject, detail, previous_hash, hash
         from audit_events where tenant_id = $1 order by sequence desc limit $2`,
      [tenantId, Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map(rowToEvent);
  }

  /** Most recent events across every scope, newest first (platform admin view). */
  async listRecent(limit: number, filters: { tenantId?: string | null; action?: string; from?: Date; to?: Date } = {}): Promise<AuditEvent[]> {
    const values: unknown[] = [];
    const conditions: string[] = [];
    const where = (column: string, operator: string, value: unknown) => {
      values.push(value);
      conditions.push(`${column} ${operator} $${values.length}`);
    };
    if (filters.tenantId !== undefined) where("tenant_id", "is not distinct from", filters.tenantId);
    if (filters.action) where("action", "=", filters.action);
    if (filters.from) where("occurred_at", ">=", filters.from);
    if (filters.to) where("occurred_at", "<", filters.to);
    values.push(Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 500) : 100);
    const { rows } = await this.pool.query(
      `select sequence, tenant_id, occurred_at, actor, action, subject, detail, previous_hash, hash
         from audit_events ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
         order by occurred_at desc, tenant_id, sequence desc limit $${values.length}`,
      values,
    );
    return rows.map(rowToEvent);
  }

  async verifyChain(tenantId: string | null): Promise<AuditChainVerification> {
    const { rows } = await this.pool.query(
      `select sequence, tenant_id, occurred_at, actor, action, subject, detail, previous_hash, hash
         from audit_events where tenant_id is not distinct from $1 order by sequence asc`,
      [tenantId],
    );
    return verifyAuditEvents(rows.map(rowToEvent));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEvent(row: any): AuditEvent {
  return {
    sequence: Number(row.sequence),
    tenantId: row.tenant_id,
    occurredAt: new Date(row.occurred_at),
    actor: row.actor,
    action: row.action,
    subject: row.subject,
    detail: row.detail,
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}
