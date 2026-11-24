import type { TenantId } from "@opentenant/auth";
import { PgHelpdeskProjectionStore, type HelpdeskProjectionEvent } from "@opentenant/database";
import { helpdeskSource } from "../opentenant-modules";
const { claimPendingOutboxEvents, latestOutboxEventId, listTickets, markOutboxDelivered, markOutboxFailed } = helpdeskSource;
type OutboxEventRecord = Awaited<ReturnType<typeof claimPendingOutboxEvents>>[number];
import type { AuditActor } from "@opentenant/security";
import { withTenantDb } from "./tenant-db";
import { controlPlanePool } from "./control-plane";

let store: PgHelpdeskProjectionStore | null = null;

export function helpdeskProjectionStore(): PgHelpdeskProjectionStore {
  if (!store) {
    store = new PgHelpdeskProjectionStore(controlPlanePool());
  }
  return store;
}

export function projectionEventFromOutbox(record: OutboxEventRecord): HelpdeskProjectionEvent {
  const envelope = record.payload;
  return {
    eventId: record.id,
    tenantId: record.tenantId,
    ticketNumber: record.ticketNumber,
    ticketVersion: record.ticketVersion,
    kind: record.kind,
    status: envelope.status,
    priority: envelope.priority,
    category: envelope.category,
    assignedRef: envelope.assignedRef,
    openedAt: envelope.openedAt,
    updatedAt: envelope.updatedAt,
    occurredAt: envelope.occurredAt,
  };
}

export interface ProjectionPassResult {
  claimed: number;
  delivered: number;
  failed: number;
}

/**
 * One bounded projection pass for one tenant. Claim, apply, and delivery
 * acknowledgement are separate transactions by design: a crash after apply
 * redelivers the event, and the projector's monotonic version guard makes the
 * replay a no-op ("stale"). Failures release the claim with bounded retry and
 * record health without touching any ticket row.
 */
export async function runHelpdeskProjectionPass(
  tenantId: TenantId,
  options: { limit?: number } = {},
): Promise<ProjectionPassResult> {
  const projector = helpdeskProjectionStore();
  const claimed = await withTenantDb(tenantId, (client) =>
    claimPendingOutboxEvents(client, tenantId, options.limit ?? 25),
  );
  const result: ProjectionPassResult = { claimed: claimed.length, delivered: 0, failed: 0 };
  for (const record of claimed) {
    try {
      const applied = await projector.applyEvent(projectionEventFromOutbox(record));
      if (applied === "rejected") {
        await withTenantDb(tenantId, (client) =>
          markOutboxFailed(client, tenantId, record.id, "projection_rejected", {
            permanent: true,
          }),
        );
        result.failed += 1;
        continue;
      }
      // "stale" is a successful idempotent replay, acknowledged like "applied".
      await withTenantDb(tenantId, (client) => markOutboxDelivered(client, tenantId, record.id));
      result.delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "projection_failed";
      await projector.recordFailure(tenantId, message).catch(() => undefined);
      await withTenantDb(tenantId, (client) =>
        markOutboxFailed(client, tenantId, record.id, message),
      ).catch(() => undefined);
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Rebuilds one tenant's projection rows from canonical tenant state without
 * owner queue reads ever fanning out. Canonical rows are read inside the
 * tenant's own database context; only queue metadata crosses the boundary.
 */
export async function rebuildHelpdeskProjection(
  tenantId: TenantId,
  actor: AuditActor,
): Promise<{ rebuilt: number; rejected: number }> {
  const canonical = await withTenantDb(tenantId, async (client) => {
    const tickets = await listTickets(client, tenantId);
    const checkpoint = await latestOutboxEventId(client, tenantId);
    return { tickets, checkpoint };
  });
  return helpdeskProjectionStore().rebuildForTenant({
    tenantId,
    actor,
    latestEventId: canonical.checkpoint,
    rows: canonical.tickets.map((ticket) => ({
      tenantId: ticket.tenantId,
      ticketNumber: ticket.ticketNumber,
      ticketVersion: ticket.version,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      assignedRef: ticket.assignedTo,
      openedAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    })),
  });
}
