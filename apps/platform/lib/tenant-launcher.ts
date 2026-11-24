import { tenantPublicOrigin } from "./server-config";
import type {
  IdentityGateway,
  IdentitySession,
  TenantMembership,
  TenantRole,
} from "@opentenant/auth";
import type { Pool } from "pg";
import { normalizeHost } from "@opentenant/domains";
import { controlPlanePool } from "./control-plane";
import { identityGateway } from "./identity";

export type TenantLauncherCard =
  | Readonly<{
      tenantId: string;
      displayName: string;
      role: TenantRole;
      availability: "available";
      launchUrl: string;
    }>
  | Readonly<{
      tenantId: string;
      displayName: string;
      role: TenantRole;
      availability: "unavailable";
    }>;

type LauncherRow = Readonly<{
  tenantId: string;
  displayName: string;
  tenantStatus: string;
  host: string | null;
  domainKind: string | null;
  domainVerification: string | null;
  domainActive: boolean | null;
}>;

function activeMembershipRoles(
  session: IdentitySession,
  memberships: ReadonlyArray<TenantMembership>,
): Map<string, TenantRole> {
  const roles = new Map<string, TenantRole>();
  const conflicts = new Set<string>();
  for (const membership of memberships) {
    if (membership.status !== "active" || membership.userId !== session.userId) continue;
    if (conflicts.has(membership.tenantId)) continue;
    const current = roles.get(membership.tenantId);
    if (!current) {
      roles.set(membership.tenantId, membership.role);
    } else if (current !== membership.role) {
      roles.delete(membership.tenantId);
      conflicts.add(membership.tenantId);
    }
  }
  return roles;
}

function eligibleHost(row: LauncherRow): string | null {
  if (
    row.host === null
    || row.domainKind !== "opentenant_subdomain"
    || row.domainVerification !== "verified"
    || row.domainActive !== true
  ) return null;

  const normalized = normalizeHost(row.host);
  return normalized === row.host ? normalized : null;
}

/**
 * Produces the closed tenant-launcher projection from verified identity
 * memberships and control-plane state. Request values are deliberately not
 * inputs: only internal tenant IDs returned by IdentityGateway reach SQL.
 */
export async function tenantLauncherData(
  session: IdentitySession,
  gateway: Pick<IdentityGateway, "listMemberships">,
  database: Pick<Pool, "query">,
  originForHost: (host: string) => string = host => `https://${host}`,
): Promise<TenantLauncherCard[]> {
  const roles = activeMembershipRoles(session, await gateway.listMemberships(session.userId));
  const tenantIds = [...roles.keys()].sort();
  if (tenantIds.length === 0) return [];

  const { rows } = await database.query<LauncherRow>(
    `select t.tenant_id as "tenantId", t.display_name as "displayName",
            t.status as "tenantStatus", d.host, d.kind as "domainKind",
            d.verification as "domainVerification", d.active as "domainActive"
       from tenants t
       left join domains d on d.tenant_id = t.tenant_id
      where t.tenant_id = any($1::text[])
        and t.status = 'active'
      order by t.display_name asc, t.tenant_id asc, d.host asc`,
    [tenantIds],
  );

  const tenants = new Map<string, { displayName: string; host: string | null }>();
  for (const row of rows) {
    if (!roles.has(row.tenantId) || row.tenantStatus !== "active") continue;
    const current = tenants.get(row.tenantId) ?? { displayName: row.displayName, host: null };
    const candidate = eligibleHost(row);
    if (candidate !== null && (current.host === null || candidate < current.host)) current.host = candidate;
    tenants.set(row.tenantId, current);
  }

  return [...tenants.entries()]
    .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName) || a[0].localeCompare(b[0]))
    .map(([tenantId, tenant]): TenantLauncherCard => {
      const role = roles.get(tenantId)!;
      return tenant.host === null
        ? { tenantId, displayName: tenant.displayName, role, availability: "unavailable" }
        : { tenantId, displayName: tenant.displayName, role, availability: "available", launchUrl: originForHost(tenant.host) };
    });
}

export function tenantLauncher(session: IdentitySession): Promise<TenantLauncherCard[]> {
  return tenantLauncherData(session, identityGateway(), controlPlanePool(), tenantPublicOrigin);
}
