import type { PoolClient } from "pg";
import { queueEntitlementSync } from "./authz-lifecycle";

/** Existing assignments only. The caller owns the mutation/audit transaction. */
export async function updateEntitlementWithAuthorization(client: Pick<PoolClient, "query">, input: {
  tenantId: string; moduleKey: string; enabled: boolean;
}): Promise<boolean> {
  const { rowCount } = await client.query(
    "update tenant_modules set enabled=$3 where tenant_id=$1 and module_key=$2 returning module_key",
    [input.tenantId, input.moduleKey, input.enabled]);
  if (!rowCount) return false;
  await queueEntitlementSync(client, input);
  return true;
}
