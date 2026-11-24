import { expect } from "vitest";
import { Pool } from "pg";
import { TENANT_CORE_MIGRATIONS } from "@opentenant/migrations/tenant-core";
import { TENANT_MODULE_CATALOGS } from "@opentenant/migrations/tenant-modules";

/** Same restricted-role proof for every provisioning provider. Synthetic inputs only. */
export async function assertProvisionedTenantRls(appUrl: string, tenant: Pool, input: { tenantId: string }) {
  if (!/^tenant_[a-z]+$/.test(input.tenantId)) throw new Error("Invalid synthetic proof tenant");
  const app = new Pool({ connectionString: appUrl, max: 1 });
  try {
    expect((await app.query("select * from support.tickets")).rowCount).toBe(0);
    await expect(app.query("insert into support.tickets (tenant_id,ticket_number,created_by,subject,description) values ($1,'SUP-000001','user_synthetic','Proof','Synthetic')", [input.tenantId])).rejects.toMatchObject({ code: "42501" });
    const client = await app.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id',$1,true)", [input.tenantId]);
      await client.query("insert into support.tickets (tenant_id,ticket_number,created_by,subject,description) values ($1,'SUP-000001','user_synthetic','Proof','Synthetic')", [input.tenantId]);
      expect((await client.query("select * from support.tickets")).rowCount).toBe(1);
      await expect(client.query("delete from support.tickets")).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
      await client.query("begin");
      await client.query("select set_config('app.tenant_id','tenant_other',true)");
      await expect(client.query("insert into support.tickets (tenant_id,ticket_number,created_by,subject,description) values ($1,'SUP-000002','user_synthetic','Proof','Synthetic')", [input.tenantId])).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
    } finally { client.release(); }
    expect((await app.query("select * from brain.entities")).rowCount).toBe(0);
    const role = await app.query("select rolsuper,rolbypassrls from pg_roles where rolname = current_user");
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    // Every catalogued tenant migration, and nothing else, reached the tenant.
    const expectedMigrations = TENANT_CORE_MIGRATIONS.length + TENANT_MODULE_CATALOGS.flat().length;
    expect((await tenant.query("select count(*)::int as n from schema_migrations")).rows[0].n).toBe(expectedMigrations);
  } finally { await app.end(); }
}
