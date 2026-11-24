import type { Pool } from "pg";
import { prepareTenantDatabase } from "@opentenant/provisioning";
import { serverConfig } from "./server-config";
/**
 * Server-only tenant provisioning service (spec section 9.2, work package 3).
 * Wires the WP3 provisionTenant orchestrator to concrete implementations:
 * Neon project creation, app-role creation, tenant-core migration, encrypted
 * connection storage, and checkpointed job tracking in the control plane.
 *
 * Requires NEON_API_KEY (project creation) and TENANT_DB_ENCRYPTION_KEY.
 */
import { CredentialCipher } from "@opentenant/database";
import {
  NeonProvisioner, PostgresProvisioner, createPostgresAppRole,
  provisionTenant,
  createAppRole,
  type ProvisioningCheckpoint,
} from "@opentenant/provisioning";
import { controlPlanePool } from "./control-plane";

export interface ProvisionInput {
  tenantId: string;
  tenantSlug: string;
  dataRegion: "us" | "eu" | "ap";
}

/** Another request already holds this tenant's provisioning claim. */
export class ProvisioningInProgressError extends Error {
  constructor() {
    super("tenant provisioning already in progress");
    this.name = "ProvisioningInProgressError";
  }
}

// Every checkpoint write bumps updated_at, so a claim this old belongs to a
// run that died between steps and may be taken over.
const STALE_CLAIM_INTERVAL = "15 minutes";

/**
 * Atomically claims the tenant's provisioning job. Two overlapping runs
 * would otherwise both create a Neon project, or rotate the tenant_app
 * password out from under each other and store a URI that no longer works.
 */
async function claimProvisioningJob(db: Pool, tenantId: string): Promise<void> {
  const { rows } = await db.query<{ tenant_id: string }>(
    `insert into provisioning_jobs (tenant_id, kind, status)
     values ($1, 'provision', 'running')
     on conflict (tenant_id, kind) do update
       set status = 'running', updated_at = now()
       where provisioning_jobs.status <> 'running'
          or provisioning_jobs.updated_at < now() - $2::interval
     returning tenant_id`,
    [tenantId, STALE_CLAIM_INTERVAL],
  );
  if (rows.length === 0) throw new ProvisioningInProgressError();
}

/** Runs the full provisioning sequence for a tenant. Idempotent per tenant. */
export async function provisionTenantProject(input: ProvisionInput): Promise<{ projectId: string }> {
  const neonKey = serverConfig().NEON_API_KEY;
  const orgId = serverConfig().NEON_ORG_ID;
  const config = serverConfig();
  const provider = config.PROVISIONING_PROVIDER ?? "neon";
  if (provider === "neon" && (!neonKey || !orgId)) throw new Error("Missing NEON_API_KEY or NEON_ORG_ID");
  const cipher = CredentialCipher.fromEnv(serverConfig());
  const db = controlPlanePool();
  const neon = provider === "postgres"
    ? new PostgresProvisioner(config.POSTGRES_ADMIN_DATABASE_URL ?? "", config.POSTGRES_TENANT_REGION)
    : new NeonProvisioner({ apiKey: neonKey!, orgId: orgId! });
  await claimProvisioningJob(db, input.tenantId);

  return provisionTenant(
    {
      neon,
      createAppRole: provider === "postgres" ? createPostgresAppRole : createAppRole,
      applyTenantCoreMigrations: prepareTenantDatabase,
      verifyTenantMigrations: prepareTenantDatabase,
      async storeTenantDatabase(tenantId, projectId, region, connectionUri) {
        const encrypted = cipher.encrypt(connectionUri, tenantId);
        await db.query(
          `insert into tenant_databases (tenant_id, provider, region, encrypted_connection, updated_at)
           values ($1, $4, $2, decode($3,'base64'), now())
           on conflict (tenant_id) do update set provider = $4, region = $2, encrypted_connection = decode($3,'base64'), updated_at = now()`,
          [tenantId, region, Buffer.from(encrypted).toString("base64"), provider],
        );
      },
      jobs: {
        async getCheckpoint(tenantId): Promise<ProvisioningCheckpoint> {
          const { rows } = await db.query<{ project_id: string | null; region: string | null; migrated: boolean; stored: boolean }>(
            "select project_id, region, migrated, stored from provisioning_jobs where tenant_id = $1 and kind = 'provision'",
            [tenantId],
          );
          const r = rows[0];
          return {
            projectId: r?.project_id ?? null,
            region: r?.region ?? null,
            migrated: r?.migrated ?? false,
            stored: r?.stored ?? false,
          };
        },
        async recordProjectCreated(tenantId, projectId, region) {
          await db.query(
            `insert into provisioning_jobs (tenant_id, kind, status, project_id, region)
             values ($1, 'provision', 'running', $2, $3)
             on conflict (tenant_id, kind) do update set status='running', project_id=$2, region=$3, updated_at=now()`,
            [tenantId, projectId, region],
          );
        },
        async recordMigrated(tenantId) {
          await db.query("update provisioning_jobs set migrated=true, updated_at=now() where tenant_id=$1 and kind='provision'", [tenantId]);
        },
        async recordStored(tenantId) {
          await db.query("update provisioning_jobs set stored=true, updated_at=now() where tenant_id=$1 and kind='provision'", [tenantId]);
        },
        async recordCompleted(tenantId) {
          await db.query("update provisioning_jobs set status='completed', updated_at=now() where tenant_id=$1 and kind='provision'", [tenantId]);
        },
        async recordFailed(tenantId, message) {
          await db.query(
            `insert into provisioning_jobs (tenant_id, kind, status, last_error, attempts)
             values ($1, 'provision', 'failed', $2, 1)
             on conflict (tenant_id, kind) do update
             set status='failed', last_error=$2, attempts=provisioning_jobs.attempts+1, updated_at=now()`,
            [tenantId, message.slice(0, 200)],
          );
        },
      },
    },
    input,
  );
}
