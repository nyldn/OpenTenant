import { assertProvisionedTenantRls } from "../test/provisioning-proof";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { NeonProvisioner } from "@opentenant/provisioning";
import { CredentialCipher } from "@opentenant/database";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { loadControlPlaneMigrations } from "../../../tooling/migrations/src/local.mjs";
import { applyMigrations } from "@opentenant/migrations";
import { provisionTenantProject } from "./provisioning";

const controlUrl = integrationDatabaseUrl("PROVISIONING_CONTROL_DATABASE_URL");
const tenantUrl = integrationDatabaseUrl("PROVISIONING_TENANT_DATABASE_URL");
const integration = controlUrl && tenantUrl ? describe : describe.skip;

integration("production provisioning with only the Neon API faked", () => {
  if (!controlUrl || !tenantUrl) return;
  const control = new Pool({ connectionString: controlUrl });
  const tenant = new Pool({ connectionString: tenantUrl });
  const key = Buffer.alloc(32, 3).toString("base64");
  beforeAll(async () => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", controlUrl);
    vi.stubEnv("TENANT_DB_ENCRYPTION_KEY", key);
    vi.stubEnv("NEON_API_KEY", "synthetic"); vi.stubEnv("NEON_ORG_ID", "synthetic");
    await applyMigrations(control, await loadControlPlaneMigrations());
    await control.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ('tenant_proof','proof','Proof','provisioning','us') on conflict do nothing");
    vi.spyOn(NeonProvisioner.prototype, "findProjectByName").mockResolvedValue(null);
    vi.spyOn(NeonProvisioner.prototype, "createTenantProject").mockResolvedValue({ projectId: "synthetic", connectionUri: tenantUrl, region: "aws-us-east-1" });
    vi.spyOn(NeonProvisioner.prototype, "getConnectionUri").mockResolvedValue(tenantUrl);
  }, 120_000); // Applies the full control-plane catalog against real Postgres.
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await control.end(); await tenant.end();
    const shared = globalThis as typeof globalThis & { [key: symbol]: Pool | undefined };
    await shared[Symbol.for("opentenant.control-plane-pool")]?.end();
    delete shared[Symbol.for("opentenant.control-plane-pool")];
  });
  it("provisions all schemas, resumes without credential rotation, and enforces restricted support writes", async () => {
    expect.assertions(9);
    const input = { tenantId: "tenant_proof", tenantSlug: "proof", dataRegion: "us" as const };
    await provisionTenantProject(input);
    const record = await control.query<{ encrypted_connection: Buffer }>("select encrypted_connection from tenant_databases where tenant_id = $1", [input.tenantId]);
    // Match tenant-db's bytea decoding: storage contains the base64 wire string.
    const appUrl = new CredentialCipher(key).decrypt(record.rows[0].encrypted_connection.toString("utf8"), input.tenantId);
    await provisionTenantProject(input);
    const resumed = await control.query<{ encrypted_connection: Buffer }>("select encrypted_connection from tenant_databases where tenant_id = $1", [input.tenantId]);
    expect(resumed.rows[0].encrypted_connection).toEqual(record.rows[0].encrypted_connection);
    await assertProvisionedTenantRls(appUrl, tenant, input);
  });
});
