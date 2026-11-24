import "server-only";
import type { PoolClient } from "pg";
import type { BrandPolicyRow, RoutineArea } from "../../../lib/tenant-settings-store";

/** Serialize policy creation and re-read locks in the caller's transaction. */
export async function lockBrandPolicy(client: PoolClient, tenantId: string): Promise<BrandPolicyRow | undefined> {
  await client.query("select tenant_id from tenants where tenant_id = $1 for update", [tenantId]);
  const { rows } = await client.query<BrandPolicyRow>("select defaults, locked_keys, overrides from brand_policies where tenant_id = $1 for update", [tenantId]);
  return rows[0];
}

/** Compare routine edits with the tenant-owned row under its write lock. */
export async function readRoutineMetadata(client: PoolClient, area: RoutineArea, tenantId: string, resourceKey: string): Promise<Record<string, string | null> | undefined> {
  const selects = {
    domain_metadata: 'select display_label as "displayLabel", verification_note as "verificationNote" from domains where tenant_id=$1 and host=$2 for update',
    integration_metadata: 'select display_name as "displayName", health_note as "healthNote" from oauth_token_vault where tenant_id=$1 and provider=$2 for update',
    module_metadata: 'select settings->>\'displayLabel\' as "displayLabel", settings->>\'supportNote\' as "supportNote" from tenant_modules where tenant_id=$1 and module_key=$2 for update',
  };
  return (await client.query<Record<string, string | null>>(selects[area], [tenantId, resourceKey])).rows[0];
}
