/**
 * Tenant-side transactional-outbox consumer operations. Rows are appended by
 * ticket mutations in the same tenant transaction (see ticket-store); these
 * functions let a consumer claim, deliver, or dead-letter events without ever
 * mutating event identity or payload. The caller owns tenant context: run
 * inside withTenantContext so app.tenant_id satisfies the fail-closed RLS
 * policies.
 */
import type { SupportClient } from "./ticket-store";
import type { OutboxEventKind, OutboxEventRecord, OutboxEventStatus, TicketOutboxEnvelope } from "./types";

export const OUTBOX_MAX_ATTEMPTS = 10;
export const OUTBOX_CLAIM_TIMEOUT_MINUTES = 5;

interface OutboxRow {
  id: string | number;
  tenant_id: string;
  ticket_id: string;
  ticket_number: string;
  ticket_version: string | number;
  kind: OutboxEventKind;
  payload: TicketOutboxEnvelope;
  occurred_at: Date;
  status: OutboxEventStatus;
  attempts: number;
  claimed_at: Date | null;
  delivered_at: Date | null;
  last_error: string | null;
}

function outboxFromRow(row: OutboxRow): OutboxEventRecord {
  return {
    id: Number(row.id),
    tenantId: row.tenant_id,
    ticketId: row.ticket_id,
    ticketNumber: row.ticket_number,
    ticketVersion: Number(row.ticket_version),
    kind: row.kind,
    payload: row.payload,
    occurredAt: row.occurred_at,
    status: row.status,
    attempts: row.attempts,
    claimedAt: row.claimed_at,
    deliveredAt: row.delivered_at,
    lastError: row.last_error,
  };
}

/**
 * Claims up to `limit` pending events in id order with `for update skip
 * locked`, so concurrent consumers never double-process a row. A stale claim
 * (older than the claim timeout) is reclaimable; each claim increments
 * `attempts` for bounded-retry accounting.
 */
export async function claimPendingOutboxEvents(
  client: SupportClient,
  tenantId: string,
  limit: number,
): Promise<OutboxEventRecord[]> {
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const { rows } = await client.query<OutboxRow>(
    `update support.outbox_events set
       claimed_at = now(),
       attempts = attempts + 1
     where id in (
       select id from support.outbox_events
        where tenant_id = $1
          and status = 'pending'
          and (claimed_at is null
               or claimed_at < now() - make_interval(mins => $3::int))
        order by id
        limit $2
        for update skip locked
     )
     returning *`,
    [tenantId, bounded, OUTBOX_CLAIM_TIMEOUT_MINUTES],
  );
  return rows.map(outboxFromRow);
}

export async function markOutboxDelivered(
  client: SupportClient,
  tenantId: string,
  eventId: number,
): Promise<void> {
  const { rows } = await client.query<{ id: string | number }>(
    `update support.outbox_events set
       status = 'delivered',
       delivered_at = now(),
       last_error = null
     where tenant_id = $1 and id = $2 and status = 'pending'
     returning id`,
    [tenantId, eventId],
  );
  if (rows.length === 0) throw new Error("outbox event not claimable");
}

/**
 * Records a delivery failure. The event stays pending for reclaim until the
 * bounded retry budget is exhausted or the failure is classified permanent;
 * then it becomes an explicit dead-letter instead of retrying forever.
 */
export async function markOutboxFailed(
  client: SupportClient,
  tenantId: string,
  eventId: number,
  error: string,
  options: { permanent?: boolean } = {},
): Promise<OutboxEventStatus> {
  const truncated = error.length > 500 ? error.slice(0, 500) : error;
  const { rows } = await client.query<{ status: OutboxEventStatus }>(
    `update support.outbox_events set
       status = case
         when $4::boolean or attempts >= $5::int then 'dead'
         else 'pending'
       end,
       claimed_at = null,
       last_error = $3
     where tenant_id = $1 and id = $2 and status = 'pending'
     returning status`,
    [tenantId, eventId, truncated, options.permanent === true, OUTBOX_MAX_ATTEMPTS],
  );
  if (rows.length === 0) throw new Error("outbox event not claimable");
  return rows[0]!.status;
}

/** Dead-letter visibility for operators; content-free by construction. */
export async function listDeadOutboxEvents(
  client: SupportClient,
  tenantId: string,
  limit = 50,
): Promise<OutboxEventRecord[]> {
  const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
  const { rows } = await client.query<OutboxRow>(
    `select * from support.outbox_events
      where tenant_id = $1 and status = 'dead'
      order by id desc
      limit $2`,
    [tenantId, bounded],
  );
  return rows.map(outboxFromRow);
}

/** Highest appended event id; reconciliation compares this to the projection checkpoint. */
export async function latestOutboxEventId(
  client: SupportClient,
  tenantId: string,
): Promise<number> {
  const { rows } = await client.query<{ max_id: string | number | null }>(
    `select max(id) as max_id from support.outbox_events where tenant_id = $1`,
    [tenantId],
  );
  return rows[0]?.max_id === null || rows[0]?.max_id === undefined ? 0 : Number(rows[0].max_id);
}
