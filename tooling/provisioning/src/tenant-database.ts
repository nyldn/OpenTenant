import { Pool } from "pg";
import { migrateTenantCore } from "@opentenant/migrations/tenant-core";
import { migrateTenantModules } from "@opentenant/migrations/tenant-modules";
import { ensureAppRole } from "./app-role";

async function seedTenantMetadata(
  tenantPool: Pool,
  tenantId: string,
  dataRegion: "us" | "eu" | "ap",
): Promise<void> {
  const client = await tenantPool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [tenantId]);
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const { rows } = await client.query<{ data_region: string }>(
      "select data_region from tenant_core.tenant_meta where tenant_id = $1",
      [tenantId],
    );
    const existingRegion = rows[0]?.data_region;
    if (existingRegion !== undefined && existingRegion !== dataRegion) {
      throw new Error("tenant metadata region does not match requested provisioning region");
    }
    if (existingRegion === undefined) {
      await client.query(
        `insert into tenant_core.tenant_meta (tenant_id, data_region)
         values ($1, $2)`,
        [tenantId, dataRegion],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Reentrant production schema path. Each catalog records checksums independently. */
export async function prepareTenantDatabase(connectionUri: string, tenantId: string, dataRegion: "us" | "eu" | "ap") {
  const tenantPool = new Pool({ connectionString: connectionUri, max: 1 });
  try {
    await migrateTenantCore(tenantPool);
    await seedTenantMetadata(tenantPool, tenantId, dataRegion);
    await ensureAppRole(connectionUri);
    await migrateTenantModules(tenantPool);
  } finally {
    await tenantPool.end();
  }
}
