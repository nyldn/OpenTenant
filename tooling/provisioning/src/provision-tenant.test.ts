import { describe, expect, it, vi } from "vitest";
import {
  provisionTenant,
  type ProvisioningCheckpoint,
  type ProvisioningDeps,
} from "./provision-tenant";

const input = {
  tenantId: "tenant_a",
  tenantSlug: "tenant-a",
  dataRegion: "us" as const,
};
const connectionUri = "postgresql://tenant:secret@db.example.test/tenant";

function harness(checkpoint: ProvisioningCheckpoint) {
  const events: string[] = [];
  const findProjectByName = vi.fn(
    async (): Promise<{ projectId: string; region: string } | null> => {
      events.push("find");
      return null;
    },
  );
  const createTenantProject = vi.fn(async () => {
    events.push("create");
    return { projectId: "project_a", region: "aws-us-east-1", connectionUri };
  });
  const getConnectionUri = vi.fn(async () => {
    events.push("get-connection-uri");
    return connectionUri;
  });
  const neon = {
    findProjectByName,
    createTenantProject,
    getConnectionUri,
  } as unknown as ProvisioningDeps["neon"];
  const applyTenantCoreMigrations = vi.fn(async () => {
    events.push("migrate");
  });
  const storeTenantDatabase = vi.fn(async () => {
    events.push("store");
  });
  const jobs: ProvisioningDeps["jobs"] = {
    getCheckpoint: vi.fn(async () => {
      events.push("get-checkpoint");
      return checkpoint;
    }),
    recordProjectCreated: vi.fn(async () => {
      events.push("record-project-created");
    }),
    recordMigrated: vi.fn(async () => {
      events.push("record-migrated");
    }),
    recordStored: vi.fn(async () => {
      events.push("record-stored");
    }),
    recordCompleted: vi.fn(async () => {
      events.push("complete");
    }),
    recordFailed: vi.fn(async (_tenantId: string, message: string) => {
      events.push(`failed:${message}`);
    }),
  };
  const createAppRole = vi.fn(async (ownerConnectionUri: string) => {
    events.push("create-app-role");
    return { appConnectionUri: ownerConnectionUri.replace("neondb_owner", "tenant_app") };
  });
  const deps: ProvisioningDeps = {
    neon,
    createAppRole,
    applyTenantCoreMigrations,
    storeTenantDatabase,
    jobs,
  };

  return {
    deps,
    events,
    findProjectByName,
    createTenantProject,
    getConnectionUri,
    applyTenantCoreMigrations,
    storeTenantDatabase,
    jobs,
  };
}

describe("provisionTenant", () => {
  it("creates, migrates, stores, and completes a fresh tenant in order", async () => {
    const test = harness({ projectId: null, region: null, migrated: false, stored: false });

    await expect(provisionTenant(test.deps, input)).resolves.toEqual({ projectId: "project_a" });

    expect(test.events).toEqual([
      "get-checkpoint",
      "find",
      "create",
      "record-project-created",
      "migrate",
      "record-migrated",
      "create-app-role",
      "store",
      "record-stored",
      "complete",
    ]);
    expect(test.findProjectByName).toHaveBeenCalledExactlyOnceWith("opentenant-tenant-tenant-a");
    expect(test.getConnectionUri).not.toHaveBeenCalled();
    expect(test.applyTenantCoreMigrations).toHaveBeenCalledExactlyOnceWith(
      connectionUri,
      input.tenantId,
      input.dataRegion,
    );
  });

  it("recovers an orphaned project before migrating and storing a fresh tenant", async () => {
    const test = harness({ projectId: null, region: null, migrated: false, stored: false });
    test.findProjectByName.mockImplementationOnce(async () => {
      test.events.push("find");
      return { projectId: "project_orphaned", region: "aws-us-east-1" };
    });

    await expect(provisionTenant(test.deps, input)).resolves.toEqual({
      projectId: "project_orphaned",
    });

    expect(test.createTenantProject).not.toHaveBeenCalled();
    expect(test.getConnectionUri).toHaveBeenCalledExactlyOnceWith("project_orphaned");
    expect(test.applyTenantCoreMigrations).toHaveBeenCalledTimes(1);
    expect(test.storeTenantDatabase).toHaveBeenCalledTimes(1);
    expect(test.events).toEqual([
      "get-checkpoint",
      "find",
      "record-project-created",
      "get-connection-uri",
      "migrate",
      "record-migrated",
      "create-app-role",
      "store",
      "record-stored",
      "complete",
    ]);
  });

  it("ignores migrated and stored flags when a corrupt checkpoint has no project", async () => {
    const test = harness({ projectId: null, region: null, migrated: true, stored: true });

    await expect(provisionTenant(test.deps, input)).resolves.toEqual({ projectId: "project_a" });

    expect(test.createTenantProject).toHaveBeenCalledTimes(1);
    expect(test.applyTenantCoreMigrations).toHaveBeenCalledTimes(1);
    expect(test.storeTenantDatabase).toHaveBeenCalledTimes(1);
    expect(test.events).toEqual([
      "get-checkpoint",
      "find",
      "create",
      "record-project-created",
      "migrate",
      "record-migrated",
      "create-app-role",
      "store",
      "record-stored",
      "complete",
    ]);
  });

  it("resumes an existing unmigrated and unstored project", async () => {
    const test = harness({
      projectId: "project_a",
      region: "aws-us-east-1",
      migrated: false,
      stored: false,
    });

    await provisionTenant(test.deps, input);

    expect(test.createTenantProject).not.toHaveBeenCalled();
    expect(test.getConnectionUri).toHaveBeenCalledExactlyOnceWith("project_a");
    expect(test.events).toEqual([
      "get-checkpoint",
      "get-connection-uri",
      "migrate",
      "record-migrated",
      "create-app-role",
      "store",
      "record-stored",
      "complete",
    ]);
  });

  it("only stores when the existing project is already migrated", async () => {
    const test = harness({
      projectId: "project_a",
      region: "aws-us-east-1",
      migrated: true,
      stored: false,
    });

    await provisionTenant(test.deps, input);

    expect(test.createTenantProject).not.toHaveBeenCalled();
    expect(test.applyTenantCoreMigrations).not.toHaveBeenCalled();
    expect(test.events).toEqual([
      "get-checkpoint",
      "get-connection-uri",
      "create-app-role",
      "store",
      "record-stored",
      "complete",
    ]);
  });

  it("rechecks migration catalogs for completed legacy checkpoints without rotating stored credentials", async () => {
    const { deps } = harness({ projectId: "project_existing", region: "aws-us-east-1", migrated: true, stored: true });
    deps.verifyTenantMigrations = vi.fn().mockResolvedValue(undefined);
    await provisionTenant(deps, { tenantId: "tenant_a", tenantSlug: "alpha", dataRegion: "us" });
    expect(deps.verifyTenantMigrations).toHaveBeenCalledOnce();
    expect(deps.createAppRole).not.toHaveBeenCalled();
    expect(deps.storeTenantDatabase).not.toHaveBeenCalled();
  });

  it("records a migration failure and rethrows it", async () => {
    const test = harness({
      projectId: "project_a",
      region: "aws-us-east-1",
      migrated: false,
      stored: false,
    });
    const migrationError = new Error("migration failed");
    test.applyTenantCoreMigrations.mockImplementationOnce(async () => {
      test.events.push("migrate");
      throw migrationError;
    });

    await expect(provisionTenant(test.deps, input)).rejects.toBe(migrationError);

    expect(test.jobs.recordFailed).toHaveBeenCalledExactlyOnceWith(input.tenantId, "tenant provisioning failed");
    expect(test.events).toEqual([
      "get-checkpoint",
      "get-connection-uri",
      "migrate",
      "failed:tenant provisioning failed",
    ]);
    expect(test.storeTenantDatabase).not.toHaveBeenCalled();
    expect(test.jobs.recordCompleted).not.toHaveBeenCalled();
  });
});
