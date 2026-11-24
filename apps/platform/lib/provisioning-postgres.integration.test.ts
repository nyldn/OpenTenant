import { assertProvisionedTenantRls } from "../test/provisioning-proof";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresProvisioner } from "@opentenant/provisioning";
import { CredentialCipher } from "@opentenant/database";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { loadControlPlaneMigrations } from "../../../tooling/migrations/src/local.mjs";
import { applyMigrations } from "@opentenant/migrations";
import { provisionTenantProject } from "./provisioning";

const controlUrl = integrationDatabaseUrl("PROVISIONING_CONTROL_DATABASE_URL");
const tenantUrl = integrationDatabaseUrl("PROVISIONING_TENANT_DATABASE_URL");
const integration = controlUrl && tenantUrl ? describe : describe.skip;

integration("self-hosted Postgres provisioning", () => {
  if (!controlUrl || !tenantUrl) return;
  const control = new Pool({ connectionString: controlUrl });
  let tenant: Pool;
  const provider = new PostgresProvisioner(process.env.ADMIN_DATABASE_URL!, "synthetic-us");
  const key = Buffer.alloc(32, 3).toString("base64");
  beforeAll(async () => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", controlUrl);
    vi.stubEnv("TENANT_DB_ENCRYPTION_KEY", key);
    vi.stubEnv("PROVISIONING_PROVIDER", "postgres");
    vi.stubEnv("POSTGRES_ADMIN_DATABASE_URL", process.env.ADMIN_DATABASE_URL!);
    vi.stubEnv("POSTGRES_TENANT_REGION", "synthetic-us");
    await applyMigrations(control, await loadControlPlaneMigrations());
    await control.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ('tenant_pgproof','pgproof','Proof','provisioning','ap') on conflict do nothing");
  }, 120_000); // Applies the full control-plane catalog against real Postgres.
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await control.end(); await tenant?.end();
    for (const slug of ["pgproof", "pgother"]) {
      const found = await provider.findProjectByName(`opentenant-tenant-${slug}`);
      if (found) await provider.deleteProject(found.projectId);
    }
    const shared = globalThis as typeof globalThis & { [key: symbol]: Pool | undefined };
    await shared[Symbol.for("opentenant.control-plane-pool")]?.end();
    delete shared[Symbol.for("opentenant.control-plane-pool")];
  });
  it("provisions a self-hosted database, preserves credentials on resume, and enforces RLS", async () => {
    expect.assertions(9);
    const input = { tenantId: "tenant_pgproof", tenantSlug: "pgproof", dataRegion: "ap" as const };
    const { projectId } = await provisionTenantProject(input);
    tenant = new Pool({ connectionString: await provider.getConnectionUri(projectId) });
    const record = await control.query<{ encrypted_connection: Buffer }>("select encrypted_connection from tenant_databases where tenant_id = $1", [input.tenantId]);
    // Match tenant-db's bytea decoding: storage contains the base64 wire string.
    const appUrl = new CredentialCipher(key).decrypt(record.rows[0].encrypted_connection.toString("utf8"), input.tenantId);
    await provisionTenantProject(input);
    const resumed = await control.query<{ encrypted_connection: Buffer }>("select encrypted_connection from tenant_databases where tenant_id = $1", [input.tenantId]);
    expect(resumed.rows[0].encrypted_connection).toEqual(record.rows[0].encrypted_connection);
    await assertProvisionedTenantRls(appUrl, tenant, input);
  });
  it("keeps runtime credentials independent and denies cross-database connections", async () => {
    await control.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ('tenant_pgother','pgother','Other','provisioning','us')");
    await provisionTenantProject({ tenantId: "tenant_pgother", tenantSlug: "pgother", dataRegion: "us" });
    const records = await control.query<{ tenant_id: string; encrypted_connection: Buffer }>("select tenant_id, encrypted_connection from tenant_databases where tenant_id in ('tenant_pgproof','tenant_pgother') order by tenant_id");
    const urls = records.rows.map(row => new CredentialCipher(key).decrypt(row.encrypted_connection.toString("utf8"), row.tenant_id));
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]!).username).not.toBe(new URL(urls[1]!).username);
    const original = new Pool({ connectionString: urls[1]! });
    try { expect((await original.query("select current_user")).rowCount).toBe(1); }
    finally { await original.end(); }
    const foreign = new URL(urls[0]!); foreign.pathname = new URL(urls[1]!).pathname;
    const hostile = new Pool({ connectionString: foreign.toString() });
    try { await expect(hostile.query("select 1")).rejects.toMatchObject({ code: "42501" }); }
    finally { await hostile.end(); }
  });

});
