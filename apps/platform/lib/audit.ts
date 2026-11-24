/**
 * Server-only audit helper: every privileged mutation in the admin surfaces
 * appends here (spec section 14). Detail carries identifiers and
 * configuration values only, never client content.
 */
import { PgAuditStore } from "@opentenant/database";
import type { AuditActor } from "@opentenant/security";
import { controlPlanePool } from "./control-plane";

let store: PgAuditStore | null = null;

export function auditStore(): PgAuditStore {
  if (!store) {
    store = new PgAuditStore(controlPlanePool());
  }
  return store;
}

export async function audit(
  actor: AuditActor,
  tenantId: string | null,
  action: string,
  subject: string,
  detail: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await auditStore().append({ occurredAt: new Date(), actor, tenantId, action, subject, detail });
}
