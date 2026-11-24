import { installedModules } from "../opentenant-modules";
import { PgAuditStore } from "@opentenant/database";
import {
  projectTenantActivity,
  type TenantActivityRecord,
} from "@opentenant/security";
import { tenantAdminContext } from "./tenant-admin";
import { controlPlanePool } from "./control-plane";

const RECENT_ACTIVITY_LIMIT = 100;

export type TenantActivityLoadResult =
  | {
      readonly status: "ready";
      readonly tenantName: string;
      readonly records: readonly TenantActivityRecord[];
    }
  | {
      readonly status: "denied";
      readonly reason: "anonymous" | "forbidden" | "no_tenant";
    }
  | { readonly status: "unavailable" };

function activityStore(): PgAuditStore {
  return new PgAuditStore(controlPlanePool());
}

/**
 * Loads the bounded first slice for the active tenant verified by the shared
 * admin gate. The page accepts no tenant selector: host/domain and development
 * resolution stay encapsulated in currentTenant, and audit fields are data only.
 */
export async function loadTenantActivity(): Promise<TenantActivityLoadResult> {
  const gate = await tenantAdminContext();
  if (!gate.ok) return { status: "denied", reason: gate.reason };

  const tenantId = gate.context.tenant.tenantId;
  try {
    const events = await activityStore().listForTenant(tenantId, RECENT_ACTIVITY_LIMIT);
    return {
      status: "ready",
      tenantName: gate.context.tenant.displayName,
      records: projectTenantActivity(events, tenantId, RECENT_ACTIVITY_LIMIT, installedModules.navigation.map(item => item.id)),
    };
  } catch {
    return { status: "unavailable" };
  }
}
