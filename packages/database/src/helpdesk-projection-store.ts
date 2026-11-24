/**
 * Owner-helpdesk projection store. Rows are derived from tenant support
 * outbox envelopes so owner queue views never fan out across tenant
 * databases. The projection is never ticket authority: it carries queue
 * metadata only, applies monotonically by canonical ticket version, records
 * per-tenant checkpoint/health, and can always be tombstoned or rebuilt from
 * canonical tenant state. Detail opens and mutations must re-resolve the
 * tenant database and reauthorize; nothing here grants that.
 */
import type { Pool, PoolClient } from "pg";
import type { AuditActor } from "@opentenant/security";
import { PgAuditStore } from "./audit-store";

const PROJECTION_STATUSES = new Set([
  "open",
  "in_progress",
  "awaiting_reply",
  "resolved",
  "closed",
]);
const PROJECTION_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const PROJECTION_CATEGORIES = new Set([
  "bug_report",
  "feature_request",
  "how_to",
  "account_issue",
  "billing",
  "other",
]);
/** Structural content denial, mirrored from the tenant outbox CHECK. */
const DENIED_ENVELOPE_KEYS = [
  "subject",
  "body",
  "description",
  "message",
  "messages",
  "attachment",
  "attachments",
];

export interface HelpdeskProjectionEvent {
  /** Tenant outbox event id; becomes the per-tenant checkpoint. */
  eventId: number;
  tenantId: string;
  ticketNumber: string;
  ticketVersion: number;
  kind: string;
  status: string;
  priority: string;
  category: string;
  assignedRef: string | null;
  openedAt: string;
  updatedAt: string;
  occurredAt: string;
}

export type HelpdeskProjectionApplyResult = "applied" | "stale" | "rejected";

export interface HelpdeskProjectionRow {
  tenantId: string;
  ticketNumber: string;
  status: string;
  priority: string;
  category: string;
  assignedRef: string | null;
  openedAt: Date;
  ticketUpdatedAt: Date;
  sourceVersion: number;
  sourceEventId: number | null;
  projectedAt: Date;
  tombstoned: boolean;
}

export interface HelpdeskProjectionHealth {
  tenantId: string;
  lastEventId: number;
  lastEventAt: Date | null;
  lastAppliedAt: Date | null;
  lastRebuildAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

export interface HelpdeskQueueFilter {
  tenantId?: string;
  status?: string;
  priority?: string;
  limit?: number;
}

function validateEvent(event: HelpdeskProjectionEvent): string | null {
  if (!PROJECTION_STATUSES.has(event.status)) return "invalid_status";
  if (!PROJECTION_PRIORITIES.has(event.priority)) return "invalid_priority";
  if (!PROJECTION_CATEGORIES.has(event.category)) return "invalid_category";
  if (!Number.isInteger(event.ticketVersion) || event.ticketVersion < 1) {
    return "invalid_version";
  }
  if (!Number.isInteger(event.eventId) || event.eventId < 1) return "invalid_event_id";
  for (const key of DENIED_ENVELOPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(event, key)) return "content_denied";
  }
  return null;
}

function rowFromDb(row: {
  tenant_id: string;
  ticket_number: string;
  status: string;
  priority: string;
  category: string;
  assigned_ref: string | null;
  opened_at: Date;
  ticket_updated_at: Date;
  source_version: string | number;
  source_event_id: string | number | null;
  projected_at: Date;
  tombstoned: boolean;
}): HelpdeskProjectionRow {
  return {
    tenantId: row.tenant_id,
    ticketNumber: row.ticket_number,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assignedRef: row.assigned_ref,
    openedAt: row.opened_at,
    ticketUpdatedAt: row.ticket_updated_at,
    sourceVersion: Number(row.source_version),
    sourceEventId: row.source_event_id === null ? null : Number(row.source_event_id),
    projectedAt: row.projected_at,
    tombstoned: row.tombstoned,
  };
}

export class PgHelpdeskProjectionStore {
  private readonly audit: PgAuditStore;

  constructor(private readonly pool: Pool) {
    this.audit = new PgAuditStore(pool);
  }

  /**
   * Applies one outbox envelope idempotently and monotonically: an event
   * whose canonical ticket version is not newer than the stored row leaves
   * the row untouched and reports "stale". A malformed or content-bearing
   * envelope is rejected without touching any row.
   */
  async applyEvent(event: HelpdeskProjectionEvent): Promise<HelpdeskProjectionApplyResult> {
    return this.transaction((client) => this.applyEventWithClient(client, event));
  }

  /** Applies a batch in one transaction, in ascending event-id order. */
  async applyEvents(
    events: ReadonlyArray<HelpdeskProjectionEvent>,
  ): Promise<{ applied: number; stale: number; rejected: number }> {
    const ordered = [...events].sort((a, b) => a.eventId - b.eventId);
    return this.transaction(async (client) => {
      const counts = { applied: 0, stale: 0, rejected: 0 };
      for (const event of ordered) {
        counts[await this.applyEventWithClient(client, event)] += 1;
      }
      return counts;
    });
  }

  private async applyEventWithClient(
    client: PoolClient,
    event: HelpdeskProjectionEvent,
  ): Promise<HelpdeskProjectionApplyResult> {
    const invalid = validateEvent(event);
    if (invalid) {
      await this.recordStateWithClient(client, event.tenantId, {
        lastError: invalid,
      });
      return "rejected";
    }
    const tombstoned = event.kind === "tombstone";
    const { rows } = await client.query<{ source_version: string }>(
      `insert into helpdesk_ticket_projection
         (tenant_id, ticket_number, status, priority, category, assigned_ref,
          opened_at, ticket_updated_at, source_version, source_event_id,
          projected_at, tombstoned)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
       on conflict (tenant_id, ticket_number) do update set
         status = excluded.status,
         priority = excluded.priority,
         category = excluded.category,
         assigned_ref = excluded.assigned_ref,
         opened_at = excluded.opened_at,
         ticket_updated_at = excluded.ticket_updated_at,
         source_version = excluded.source_version,
         source_event_id = excluded.source_event_id,
         projected_at = now(),
         tombstoned = excluded.tombstoned
       where excluded.source_version > helpdesk_ticket_projection.source_version
       returning source_version`,
      [
        event.tenantId,
        event.ticketNumber,
        event.status,
        event.priority,
        event.category,
        event.assignedRef,
        event.openedAt,
        event.updatedAt,
        event.ticketVersion,
        event.eventId,
        tombstoned,
      ],
    );
    await this.recordStateWithClient(client, event.tenantId, {
      lastEventId: event.eventId,
      lastEventAt: event.occurredAt,
      applied: true,
    });
    return rows.length > 0 ? "applied" : "stale";
  }

  /**
   * Immediately hides a tenant's rows from owner queues (module disablement,
   * tenant suspension/deletion, retention). Canonical tenant state is never
   * touched; the action and its scope are audited in the same transaction.
   */
  async tombstoneTenant(input: {
    tenantId: string;
    actor: AuditActor;
    reason: "module_disabled" | "tenant_suspended" | "tenant_deleted" | "retention";
  }): Promise<number> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ ticket_number: string }>(
        `update helpdesk_ticket_projection
            set tombstoned = true, projected_at = now()
          where tenant_id = $1 and tombstoned = false
          returning ticket_number`,
        [input.tenantId],
      );
      await this.audit.appendWithClient(client, {
        tenantId: input.tenantId,
        occurredAt: new Date(),
        actor: input.actor,
        action: "helpdesk.projection.tombstone_tenant",
        subject: input.tenantId,
        detail: { reason: input.reason, rows: rows.length },
      });
      return rows.length;
    });
  }

  /**
   * Re-derives a tenant's projection rows from canonical tenant state. The
   * caller reads canonical rows inside the tenant's own database context and
   * passes queue metadata only; the rebuild commits atomically with its
   * checkpoint and audit evidence. Rebuild output remains a derived index,
   * not authority.
   *
   * Rebuild races a live projection pass safely: each row upserts under the
   * same monotonic guard (allowing equal versions so a same-version
   * tombstone can be corrected), so a row applied from a newer outbox event
   * after the canonical read is never regressed. Rows absent from the
   * canonical read are removed only when their checkpoint is not newer than
   * this rebuild's, which preserves rows projected concurrently from events
   * past the rebuild's own checkpoint.
   */
  async rebuildForTenant(input: {
    tenantId: string;
    actor: AuditActor;
    rows: ReadonlyArray<Omit<HelpdeskProjectionEvent, "eventId" | "kind" | "occurredAt">>;
    latestEventId: number;
  }): Promise<{ rebuilt: number; rejected: number }> {
    return this.transaction(async (client) => {
      let rebuilt = 0;
      let rejected = 0;
      const keptTicketNumbers: string[] = [];
      for (const row of input.rows) {
        const invalid = validateEvent({
          ...row,
          eventId: Math.max(1, input.latestEventId),
          kind: "rebuild",
          occurredAt: row.updatedAt,
        });
        if (invalid) {
          rejected += 1;
          continue;
        }
        keptTicketNumbers.push(row.ticketNumber);
        await client.query(
          `insert into helpdesk_ticket_projection
             (tenant_id, ticket_number, status, priority, category, assigned_ref,
              opened_at, ticket_updated_at, source_version, source_event_id,
              projected_at, tombstoned)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), false)
           on conflict (tenant_id, ticket_number) do update set
             status = excluded.status,
             priority = excluded.priority,
             category = excluded.category,
             assigned_ref = excluded.assigned_ref,
             opened_at = excluded.opened_at,
             ticket_updated_at = excluded.ticket_updated_at,
             source_version = excluded.source_version,
             source_event_id = excluded.source_event_id,
             projected_at = now(),
             tombstoned = false
           where excluded.source_version >= helpdesk_ticket_projection.source_version`,
          [
            input.tenantId,
            row.ticketNumber,
            row.status,
            row.priority,
            row.category,
            row.assignedRef,
            row.openedAt,
            row.updatedAt,
            row.ticketVersion,
            input.latestEventId > 0 ? input.latestEventId : null,
          ],
        );
        rebuilt += 1;
      }
      await client.query(
        `delete from helpdesk_ticket_projection
          where tenant_id = $1
            and not (ticket_number = any($2::text[]))
            and (source_event_id is null or source_event_id <= $3)`,
        [input.tenantId, keptTicketNumbers, input.latestEventId],
      );
      await this.recordStateWithClient(client, input.tenantId, {
        lastEventId: input.latestEventId,
        rebuilt: true,
        applied: true,
      });
      await this.audit.appendWithClient(client, {
        tenantId: input.tenantId,
        occurredAt: new Date(),
        actor: input.actor,
        action: "helpdesk.projection.rebuild",
        subject: input.tenantId,
        detail: {
          rows: rebuilt,
          rejected,
          checkpoint: input.latestEventId,
        },
      });
      return { rebuilt, rejected };
    });
  }

  /**
   * Minimal owner queue discovery seam. Returns queue metadata only, hides
   * tombstoned rows, and never joins ticket content because none exists in
   * this schema. Authorization (owner.helpdesk.queue.read) belongs to the
   * caller; detail opens must re-resolve and reauthorize the exact tenant.
   */
  async listQueue(filter: HelpdeskQueueFilter = {}): Promise<HelpdeskProjectionRow[]> {
    const clauses = ["tombstoned = false"];
    const params: unknown[] = [];
    if (filter.tenantId) {
      params.push(filter.tenantId);
      clauses.push(`tenant_id = $${params.length}`);
    }
    if (filter.status) {
      if (!PROJECTION_STATUSES.has(filter.status)) return [];
      params.push(filter.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filter.priority) {
      if (!PROJECTION_PRIORITIES.has(filter.priority)) return [];
      params.push(filter.priority);
      clauses.push(`priority = $${params.length}`);
    }
    const limit = Math.max(1, Math.min(100, Math.trunc(filter.limit ?? 50)));
    params.push(limit);
    const { rows } = await this.pool.query(
      `select tenant_id, ticket_number, status, priority, category, assigned_ref,
              opened_at, ticket_updated_at, source_version, source_event_id,
              projected_at, tombstoned
         from helpdesk_ticket_projection
        where ${clauses.join(" and ")}
        order by ticket_updated_at desc
        limit $${params.length}`,
      params,
    );
    return rows.map(rowFromDb);
  }

  /** Projection lag/health for operators; explicitly not ticket state. */
  async health(tenantId?: string): Promise<HelpdeskProjectionHealth[]> {
    const { rows } = await this.pool.query<{
      tenant_id: string;
      last_event_id: string | number;
      last_event_at: Date | null;
      last_applied_at: Date | null;
      last_rebuild_at: Date | null;
      last_error: string | null;
      updated_at: Date;
    }>(
      tenantId
        ? `select * from helpdesk_projection_state where tenant_id = $1`
        : `select * from helpdesk_projection_state order by updated_at desc limit 200`,
      tenantId ? [tenantId] : [],
    );
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      lastEventId: Number(row.last_event_id),
      lastEventAt: row.last_event_at,
      lastAppliedAt: row.last_applied_at,
      lastRebuildAt: row.last_rebuild_at,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }));
  }

  /** Records a consumer failure without touching projection rows. */
  async recordFailure(tenantId: string, error: string): Promise<void> {
    await this.transaction((client) =>
      this.recordStateWithClient(client, tenantId, { lastError: error }),
    );
  }

  private async recordStateWithClient(
    client: PoolClient,
    tenantId: string,
    update: {
      lastEventId?: number;
      lastEventAt?: string;
      lastError?: string;
      applied?: boolean;
      rebuilt?: boolean;
    },
  ): Promise<void> {
    const lastError = update.lastError === undefined ? null : update.lastError.slice(0, 500);
    await client.query(
      `insert into helpdesk_projection_state
         (tenant_id, last_event_id, last_event_at, last_applied_at,
          last_rebuild_at, last_error, updated_at)
       values ($1, coalesce($2::bigint, 0), $3, case when $4 then now() end,
               case when $5 then now() end, $6, now())
       on conflict (tenant_id) do update set
         last_event_id = greatest(
           helpdesk_projection_state.last_event_id, coalesce($2::bigint, 0)),
         last_event_at = coalesce($3, helpdesk_projection_state.last_event_at),
         last_applied_at = case when $4 then now()
           else helpdesk_projection_state.last_applied_at end,
         last_rebuild_at = case when $5 then now()
           else helpdesk_projection_state.last_rebuild_at end,
         last_error = $6,
         updated_at = now()`,
      [
        tenantId,
        update.lastEventId ?? null,
        update.lastEventAt ?? null,
        update.applied === true,
        update.rebuilt === true,
        lastError,
      ],
    );
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
