/**
 * Tenant provisioning orchestration (spec sections 9.2, 15).
 *
 * Idempotent and resumable: each step records a checkpoint through the
 * injected job store, so a retried job resumes at the first incomplete step
 * instead of duplicating projects. Failures leave the job visible to
 * platform administrators. Connection URIs stay in memory only.
 */
import { NeonProvisioner } from "./neon";

export interface ProvisioningCheckpoint {
  projectId: string | null;
  region: string | null;
  migrated: boolean;
  stored: boolean;
}

export interface AppRoleFactory {
  /** Creates the non-BYPASSRLS application role and returns its URI. */
  (ownerConnectionUri: string): Promise<{ appConnectionUri: string }>;
}

export interface ProvisioningDeps {
  neon: Pick<NeonProvisioner, "findProjectByName" | "createTenantProject" | "getConnectionUri">;
  /** Creates the tenant_app role; tenant traffic never runs as the owner. */
  createAppRole: AppRoleFactory;
  /** Applies all tenant schema catalogs and metadata to the tenant project. Must be idempotent. */
  applyTenantCoreMigrations(
    connectionUri: string,
    tenantId: string,
    dataRegion: "us" | "eu" | "ap",
  ): Promise<void>;
  /** Rechecks all canonical catalogs on resumed jobs, including jobs completed by older code. */
  verifyTenantMigrations?: ProvisioningDeps["applyTenantCoreMigrations"];
  /** Encrypts and stores the connection record in the control plane. Must be idempotent. */
  storeTenantDatabase(tenantId: string, projectId: string, region: string, connectionUri: string): Promise<void>;
  jobs: {
    getCheckpoint(tenantId: string): Promise<ProvisioningCheckpoint>;
    recordProjectCreated(tenantId: string, projectId: string, region: string): Promise<void>;
    recordMigrated(tenantId: string): Promise<void>;
    recordStored(tenantId: string): Promise<void>;
    recordCompleted(tenantId: string): Promise<void>;
    recordFailed(tenantId: string, message: string): Promise<void>;
  };
}

export async function provisionTenant(
  deps: ProvisioningDeps,
  input: { tenantId: string; tenantSlug: string; dataRegion: "us" | "eu" | "ap" },
): Promise<{ projectId: string }> {
  try {
    const checkpoint = await deps.jobs.getCheckpoint(input.tenantId);

    let projectId = checkpoint.projectId;
    let region = checkpoint.region;
    let connectionUri: string | null = null;

    // Checkpoint invariant: later steps are meaningless without a project.
    // A checkpoint claiming migrated/stored with no project id is corrupt;
    // treat those flags as false rather than skipping required steps.
    const migrated = checkpoint.migrated && projectId !== null;
    const stored = checkpoint.stored && projectId !== null;

    if (projectId === null || region === null) {
      // Recover a project created by a run that died before its checkpoint
      // persisted, instead of creating a duplicate.
      const name = NeonProvisioner.tenantProjectName(input.tenantSlug);
      const existing = await deps.neon.findProjectByName(name);
      if (existing !== null) {
        projectId = existing.projectId;
        region = existing.region;
      } else {
        const project = await deps.neon.createTenantProject(input.tenantSlug, input.dataRegion);
        projectId = project.projectId;
        region = project.region;
        connectionUri = project.connectionUri;
      }
      await deps.jobs.recordProjectCreated(input.tenantId, projectId, region);
    }

    if (!migrated) {
      connectionUri ??= await deps.neon.getConnectionUri(projectId);
      await deps.applyTenantCoreMigrations(
        connectionUri,
        input.tenantId,
        input.dataRegion,
      );
      await deps.jobs.recordMigrated(input.tenantId);
    }

    if (migrated && deps.verifyTenantMigrations) {
      connectionUri ??= await deps.neon.getConnectionUri(projectId);
      await deps.verifyTenantMigrations(connectionUri, input.tenantId, input.dataRegion);
    }

    if (!stored) {
      connectionUri ??= await deps.neon.getConnectionUri(projectId);
      // Store the application-role URI, never the BYPASSRLS owner URI.
      const { appConnectionUri } = await deps.createAppRole(connectionUri);
      await deps.storeTenantDatabase(input.tenantId, projectId, region, appConnectionUri);
      await deps.jobs.recordStored(input.tenantId);
    }

    await deps.jobs.recordCompleted(input.tenantId);
    return { projectId };
  } catch (error) {
    const message = "tenant provisioning failed";
    await deps.jobs.recordFailed(input.tenantId, message);
    throw error;
  }
}
