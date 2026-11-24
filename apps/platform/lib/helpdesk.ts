/** Owner queue reads require installation authority; ticket detail requires managed support. */
import type { TenantId } from "@opentenant/auth";
import type { HelpdeskProjectionHealth, HelpdeskProjectionRow, HelpdeskQueueFilter } from "@opentenant/database";
import { helpdeskSource } from "../opentenant-modules";
const { getTicketByNumber } = helpdeskSource;
import { audit } from "./audit";
import { withTenantDb } from "./tenant-db";
import { installationOwnerContext } from "./installation-owner";
import { managedSupportSessionForTenant } from "./managed-support";
import { helpdeskProjectionStore } from "./helpdesk-projection";
export { helpdeskProjectionStore, projectionEventFromOutbox, runHelpdeskProjectionPass, rebuildHelpdeskProjection } from "./helpdesk-projection";
export type { ProjectionPassResult } from "./helpdesk-projection";

export type OwnerHelpdeskQueue =
  | {
      ok: true;
      rows: HelpdeskProjectionRow[];
      health: HelpdeskProjectionHealth[];
      operatorUserId: string;
    }
  | {
      ok: false;
      reason:
        | "anonymous"
        | "missing_installation_authority"
        | "unknown_installation_permission";
    };

/**
 * The minimal owner queue discovery seam. Fail-closed installation
 * authorization; rows are queue metadata only and lag/health is reported
 * separately so projection staleness is visible without being ticket state.
 */
export async function ownerHelpdeskQueue(filter: HelpdeskQueueFilter = {}): Promise<OwnerHelpdeskQueue> {
  const authorized = await installationOwnerContext("owner.helpdesk.queue.read");
  if (!authorized.ok) return { ok: false, reason: authorized.reason };
  const projector = helpdeskProjectionStore();
  const [rows, health] = await Promise.all([
    projector.listQueue(filter),
    projector.health(filter.tenantId),
  ]);
  return { ok: true, rows, health, operatorUserId: authorized.context.authority.userId };
}

const TENANT_REFERENCE = /^[a-zA-Z0-9_-]{1,128}$/;
const TICKET_REFERENCE = /^SUP-[0-9]{6}$/;

export type OwnerHelpdeskTicket =
  | { ok: true; detail: NonNullable<Awaited<ReturnType<typeof getTicketByNumber>>> }
  | {
      ok: false;
      reason:
        | "invalid_reference"
        | "anonymous"
        | "missing_installation_authority"
        | "unknown_installation_permission"
        | "tenant_support_denied"
        | "access_evidence_failed"
        | "not_found";
    };

/**
 * Canonical owner detail-open seam. Tenant/reference values discovered in the
 * projection are navigation hints only. Queue discovery authority cannot open
 * content: the sensitive customer-data permission and an active support
 * session bound to the exact tenant are rechecked before the tenant database
 * is touched.
 */
export async function ownerHelpdeskTicket(
  tenantId: string,
  ticketNumber: string,
): Promise<OwnerHelpdeskTicket> {
  if (!TENANT_REFERENCE.test(tenantId) || !TICKET_REFERENCE.test(ticketNumber)) {
    return { ok: false, reason: "invalid_reference" };
  }
  const authorized = await installationOwnerContext("owner.support.customer_data.read");
  if (!authorized.ok) return { ok: false, reason: authorized.reason };
  const support = await managedSupportSessionForTenant(tenantId);
  if (!support.ok) {
    if (support.reason === "anonymous") return { ok: false, reason: "anonymous" };
    return { ok: false, reason: "tenant_support_denied" };
  }
  const detail = await withTenantDb(tenantId as TenantId, (client) =>
    getTicketByNumber(client, tenantId, ticketNumber),
  );
  if (!detail) return { ok: false, reason: "not_found" };
  try {
    await audit(
      { kind: "installation_owner", userId: support.context.operator.userId },
      tenantId,
      "support.ticket_content_read",
      ticketNumber,
      {
        supportSessionId: support.context.sessionId,
        reason: support.context.reason ?? null,
        reference: support.context.reference ?? null,
      },
    );
  } catch {
    return { ok: false, reason: "access_evidence_failed" };
  }
  return { ok: true, detail };
}
