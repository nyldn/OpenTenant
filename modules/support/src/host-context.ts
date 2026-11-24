import type { IdentitySession, TenantId } from "@opentenant/auth";
import { expandSupportPermissions, type SupportPermission } from "./index";
import type { ModuleHostServices } from "@opentenant/database/module-host";

/**
 * Support module gate: identity-only (tickets need attribution), permission
 * set from resolvePermissions. UI hiding is never the control; the API
 * route re-runs this gate on every mutation.
 */

export interface SupportContext {
  session: IdentitySession;
  tenantId: string;
  tenantDisplayName: string;
  /** Approved fine-grained vocabulary after fail-closed legacy expansion. */
  permissions: ReadonlyArray<SupportPermission>;
  canUse: boolean;
  canAdmin: boolean;
  capabilities: {
    create: boolean;
    readOwn: boolean;
    replyOwn: boolean;
    readTenant: boolean;
    replyTenant: boolean;
    noteInternal: boolean;
    assign: boolean;
    manage: boolean;
    viewDeliveryFailures: boolean;
  };
}

export function createSupportContext(host: ModuleHostServices) {
async function supportContext(): Promise<
  | { ok: true; context: SupportContext }
  | { ok: false; reason: "anonymous" | "no_tenant" | "forbidden"; response?: Response }
> {
  const tenant = await host.currentTenant();
  if (!tenant) return host.unavailableTenantContext();
  if (!(await host.nativeModuleEnabled(tenant.tenantId, "support"))) {
    return { ok: false, reason: "forbidden" };
  }
  const session = await host.currentSession(tenant.tenantId as TenantId);
  if (!session) return { ok: false, reason: "anonymous" };
  if (session.activeTenantId !== tenant.tenantId && !session.isPlatformAdmin) {
    return { ok: false, reason: "forbidden" };
  }
  const granted = await host.resolvePermissions(session, tenant.tenantId, "support");
  // Coarse legacy grants and fine-grained slugs both normalize to the
  // approved vocabulary; unknown strings are dropped, never passed through.
  const permissions = expandSupportPermissions(granted);
  if (permissions.length === 0) {
    return { ok: false, reason: "forbidden" };
  }
  const has = (permission: SupportPermission) => permissions.includes(permission);
  const capabilities = {
    create: has("support.ticket.create"),
    readOwn: has("support.ticket.read_own"),
    replyOwn: has("support.ticket.reply_own"),
    readTenant: has("support.ticket.read_tenant"),
    replyTenant: has("support.ticket.reply"),
    noteInternal: has("support.ticket.note_internal"),
    assign: has("support.ticket.assign"),
    manage: has("support.ticket.manage"),
    viewDeliveryFailures: has("support.ticket.manage"),
  };
  return {
    ok: true,
    context: {
      session,
      tenantId: tenant.tenantId,
      tenantDisplayName: tenant.displayName,
      permissions,
      canUse: true,
      canAdmin: capabilities.manage,
      capabilities,
    },
  };
}

return supportContext;
}
