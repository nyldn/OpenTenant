import { Pool } from "pg";
import { CredentialCipher } from "@opentenant/database";

/** Read back the worker's encrypted binding. Never create schemas or grants here. */
export async function inspectProvisionedDatabase(control: Pool, tenantId: string) {
  const { rows } = await control.query<{ provider: string; encrypted_connection: Buffer }>("select provider,encrypted_connection from tenant_databases where tenant_id=$1", [tenantId]);
  const binding = rows[0];
  if (binding?.provider !== "postgres") throw new Error("Expected self-hosted provisioning");
  const runtime = new Pool({ connectionString: new CredentialCipher(process.env.TENANT_DB_ENCRYPTION_KEY!).decrypt(binding.encrypted_connection.toString("utf8"), tenantId) });
  try {
    const schemas = await runtime.query<{ nspname: string }>("select nspname from pg_namespace where nspname in ('tenant_core','brain','support') order by nspname");
    const role = await runtime.query<{ rolsuper: boolean; rolbypassrls: boolean }>("select rolsuper,rolbypassrls from pg_roles where rolname=current_user");
    return { schemas: schemas.rows.map(r => r.nspname), role: role.rows[0] };
  } finally { await runtime.end(); }
}
