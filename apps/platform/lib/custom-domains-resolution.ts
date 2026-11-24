import type { Pool } from "pg";
import type { ResolvedTenant } from "@opentenant/database";

/** No cache: removal, failed rechecks, and verification expiry take effect immediately. */
export async function verifiedCustomTenantForHost(host: string, db: Pick<Pool, "query">): Promise<ResolvedTenant | null> {
  const { rows } = await db.query<ResolvedTenant>(
    `select t.tenant_id as "tenantId", t.slug, t.display_name as "displayName", t.status
     from domains d join tenants t on t.tenant_id = d.tenant_id
     where d.host = $1 and d.kind = 'custom' and d.active and d.verification = 'verified'
       and d.verification_valid_until > now() and t.status = 'active'`, [host],
  );
  return rows[0] ?? null;
}

export async function hasVerifiedPlatformDomain(host: string, tenantId: string, db: Pick<Pool, "query">): Promise<boolean> {
  const { rows } = await db.query(
    "select 1 from domains where host = $1 and tenant_id = $2 and kind = 'opentenant_subdomain' and active and verification = 'verified'",
    [host, tenantId],
  );
  return rows.length > 0;
}
