import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

const harness = vi.hoisted(() => ({
  existingRegion: null as "us" | "eu" | null,
  hiddenOtherTenant: false,
  poolConfigs: [] as Array<{ connectionString?: string; max?: number }>,
  tenantSql: [] as string[],
  tenantValues: [] as unknown[][],
  tenantClientQuery: vi.fn(),
  tenantClientRelease: vi.fn(),
  tenantPoolEnd: vi.fn(),
  migrateTenantCore: vi.fn(),
  migrateTenantModules: vi.fn(),
  provisionTenant: vi.fn(),
  controlQuery: vi.fn(),
}));

vi.mock("pg", () => ({
  Client: class { connect = vi.fn(); query = vi.fn(); end = vi.fn(); },
  Pool: class {
    readonly query = harness.controlQuery;
    readonly config: { connectionString?: string; max?: number };

    constructor(config: { connectionString?: string; max?: number }) {
      this.config = config;
      harness.poolConfigs.push(config);
    }

    async connect() {
      return {
        query: harness.tenantClientQuery,
        release: harness.tenantClientRelease,
      };
    }

    async end(): Promise<void> {
      await harness.tenantPoolEnd();
    }
  },
}));

vi.mock("@opentenant/database", () => ({
  CredentialCipher: {
    fromEnv: () => ({ encrypt: vi.fn() }),
  },
}));

vi.mock("@opentenant/migrations/tenant-core", () => ({
  migrateTenantCore: harness.migrateTenantCore,
}));

vi.mock("@opentenant/migrations/tenant-modules", () => ({ migrateTenantModules: harness.migrateTenantModules }));

vi.mock("@opentenant/provisioning", async (importOriginal) => ({
  ...await importOriginal<typeof import("@opentenant/provisioning")>(),
  NeonProvisioner: class {},
  createAppRole: vi.fn(),
  provisionTenant: harness.provisionTenant,
}));

import { ProvisioningInProgressError, provisionTenantProject } from "./provisioning";

describe("provisionTenantProject tenant-core migration and metadata", () => {
  beforeEach(() => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://control.example.test/opentenant");
    vi.stubEnv("NEON_API_KEY", "neon_test_key");
    vi.stubEnv("NEON_ORG_ID", "neon_test_org");
    harness.existingRegion = null;
    harness.hiddenOtherTenant = false;
    harness.poolConfigs.length = 0;
    harness.tenantSql.length = 0;
    harness.tenantValues.length = 0;
    harness.tenantClientQuery.mockReset().mockImplementation(
      async (sql: string, values?: unknown[]) => {
        harness.tenantSql.push(sql);
        harness.tenantValues.push(values ?? []);
        if (sql.includes("select data_region")) {
          return {
            rows: harness.existingRegion === null
              ? []
              : [{ data_region: harness.existingRegion }],
          };
        }
        if (sql.includes("insert into tenant_core.tenant_meta") && harness.hiddenOtherTenant) {
          const error = new Error("duplicate key value violates unique constraint");
          Object.assign(error, { code: "23505" });
          throw error;
        }
        return { rows: [] };
      },
    );
    harness.controlQuery.mockReset().mockResolvedValue({ rows: [{ tenant_id: "claimed" }] });
    harness.tenantClientRelease.mockReset();
    harness.tenantPoolEnd.mockReset().mockResolvedValue(undefined);
    harness.migrateTenantCore.mockReset().mockResolvedValue({
      applied: [
        "tenant-core/0001_init",
        "tenant-core/0002_remove_identity_organization_id",
        "tenant-core/0003_single_tenant_anchor",
      ],
      skipped: [],
    });
    harness.provisionTenant.mockReset().mockImplementation(
      async (
        deps: {
          applyTenantCoreMigrations(
            connectionUri: string,
            tenantId: string,
            dataRegion: "us" | "eu",
          ): Promise<void>;
        },
        input: { tenantId: string; dataRegion: "us" | "eu" },
      ) => {
        await deps.applyTenantCoreMigrations(
          "postgresql://tenant.example.test/tenant",
          input.tenantId,
          input.dataRegion,
        );
        return { projectId: "project_existing" };
      },
    );
  });

  it("runs the canonical catalog then seeds tenant metadata under transaction-local RLS context", async () => {
    await expect(provisionTenantProject({
      tenantId: "tenant_fresh",
      tenantSlug: "tenant-fresh",
      dataRegion: "us",
    })).resolves.toEqual({ projectId: "project_existing" });

    expect(harness.migrateTenantCore).toHaveBeenCalledTimes(1);
    expect(harness.poolConfigs).toContainEqual({
      connectionString: "postgresql://tenant.example.test/tenant",
      max: 1,
    });
    expect(harness.tenantSql).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1))",
      "select set_config('app.tenant_id', $1, true)",
      expect.stringContaining("select data_region from tenant_core.tenant_meta"),
      expect.stringContaining("insert into tenant_core.tenant_meta"),
      "commit",
    ]);
    expect(harness.tenantValues[1]).toEqual(["tenant_fresh"]);
    expect(harness.tenantValues[2]).toEqual(["tenant_fresh"]);
    expect(harness.tenantValues[4]).toEqual(["tenant_fresh", "us"]);
    expect(harness.tenantClientRelease).toHaveBeenCalledTimes(1);
    expect(harness.tenantPoolEnd).toHaveBeenCalledTimes(1);
  });

  it("accepts an idempotent replay when existing metadata has the requested region", async () => {
    harness.existingRegion = "eu";

    await expect(provisionTenantProject({
      tenantId: "tenant_existing",
      tenantSlug: "tenant-existing",
      dataRegion: "eu",
    })).resolves.toEqual({ projectId: "project_existing" });

    expect(harness.tenantSql.some((sql) => sql.includes("insert into tenant_core.tenant_meta"))).toBe(false);
    expect(harness.tenantSql.at(-1)).toBe("commit");
  });

  it("fails closed and rolls back when existing tenant metadata has another region", async () => {
    harness.existingRegion = "us";

    await expect(provisionTenantProject({
      tenantId: "tenant_existing",
      tenantSlug: "tenant-existing",
      dataRegion: "eu",
    })).rejects.toThrow("tenant metadata region does not match requested provisioning region");

    expect(harness.tenantSql).toContain("rollback");
    expect(harness.tenantSql.some((sql) => sql.includes("insert into tenant_core.tenant_meta"))).toBe(false);
    expect(harness.tenantClientRelease).toHaveBeenCalledTimes(1);
    expect(harness.tenantPoolEnd).toHaveBeenCalledTimes(1);
  });

  it("closes the tenant pool without running metadata SQL when migration fails", async () => {
    harness.migrateTenantCore.mockRejectedValueOnce(new Error("migration rejected"));

    await expect(provisionTenantProject({
      tenantId: "tenant_failed",
      tenantSlug: "tenant-failed",
      dataRegion: "us",
    })).rejects.toThrow("migration rejected");

    expect(harness.tenantSql).toEqual([]);
    expect(harness.tenantClientRelease).not.toHaveBeenCalled();
    expect(harness.tenantPoolEnd).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a FORCE-RLS-hidden tenant already owns the database anchor", async () => {
    harness.hiddenOtherTenant = true;

    await expect(provisionTenantProject({
      tenantId: "tenant_second",
      tenantSlug: "tenant-second",
      dataRegion: "eu",
    })).rejects.toMatchObject({ code: "23505" });

    expect(harness.tenantSql).toContain("rollback");
    expect(harness.tenantClientRelease).toHaveBeenCalledTimes(1);
    expect(harness.tenantPoolEnd).toHaveBeenCalledTimes(1);
  });

  it("refuses to start while another run holds the tenant's provisioning claim", async () => {
    harness.controlQuery.mockResolvedValueOnce({ rows: [] });

    await expect(provisionTenantProject({
      tenantId: "tenant_busy",
      tenantSlug: "tenant-busy",
      dataRegion: "us",
    })).rejects.toBeInstanceOf(ProvisioningInProgressError);

    expect(harness.provisionTenant).not.toHaveBeenCalled();
    const [sql, values] = harness.controlQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("where provisioning_jobs.status <> 'running'");
    expect(values).toEqual(["tenant_busy", "15 minutes"]);
  });
});
