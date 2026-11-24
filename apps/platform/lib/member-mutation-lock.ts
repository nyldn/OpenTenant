import type { Pool, PoolClient } from "pg";
import type { TenantId } from "@opentenant/auth";
import { controlPlanePool } from "./control-plane";

const MEMBER_REMOVAL_LOCK_NAMESPACE = "opentenant.member-removal.v1";

export async function withTenantMemberMutationLockUsingPool<T>(
  database: Pick<Pool, "connect">,
  tenantId: TenantId,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await database.connect();
  let broken = false;
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [MEMBER_REMOVAL_LOCK_NAMESPACE, tenantId],
    );
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

export function withTenantMemberMutationLock<T>(
  tenantId: TenantId,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTenantMemberMutationLockUsingPool(controlPlanePool(), tenantId, operation);
}
