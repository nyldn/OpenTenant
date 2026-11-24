import { purgeSupportAiTicketContent, SUPPORT_AI_RETENTION_LIMIT } from "./support-ai-retention";
import { supportAiRetentionConfig } from "../lib/server-config";
import { runUsageExport } from "@opentenant/usage-export";
import { configuredUsageExportSink } from "./usage-export";
import type { TaskList } from "graphile-worker";
import type { TenantId } from "@opentenant/auth";
import { controlPlanePool, withControlPlaneTransaction } from "../lib/control-plane";
import { identityGateway, identityOrganizationPort, identityProviderFromEnv } from "../lib/identity";
import { provisionTenantProject } from "../lib/provisioning";
import { activateProvisionedTenant } from "../lib/tenant-provisioning-store";
import { issueTenantOwnerInvite } from "../lib/tenant-owner-invite";
import { runHelpdeskProjectionPass } from "../lib/helpdesk-projection";
import { exportTenant, expireTenantExports } from "../lib/tenant-export";
import { eraseTenant } from "../lib/tenant-erase";
import { workerAudit, type TenantWorkerJob } from "../lib/tenant-worker-store";
import { createTenantExportRunner, executeProvisioningJob } from "./tenant-worker-tasks";
import { CUSTOM_DOMAIN_CRONTAB, customDomainWorkerTasks } from "../lib/custom-domains-job";
import { authorizationSyncEnabled, queueMembershipSync, runConfiguredAuthorizationOutbox } from "../lib/authz-lifecycle";
import { SmtpEmailTransport } from "@opentenant/notifications/smtp";
import { helpdeskSource, installedModules } from "../opentenant-modules";
import { nativeModuleEnabled } from "../lib/module-registry";
import { serverConfig } from "../lib/server-config";
import { withTenantDb } from "../lib/tenant-db";

const runExport = createTenantExportRunner((job, signal) => exportTenant(job, undefined, { signal }));
const DISPATCH_LIMIT = 25;
let authorizationCursor = "";
let supportCursor = "";
let supportRetentionCursor = "";
const supportModule = installedModules.modules.find(module => module.services?.helpdesk === helpdeskSource);

async function supportDeliveryAllowed(tenantId: string): Promise<boolean> {
  if (!supportModule || !serverConfig().IDENTITY_SMTP_HOST) return false;
  const state = await controlPlanePool().query("select status from tenants where tenant_id=$1", [tenantId]);
  return state.rows[0]?.status === "active" && await nativeModuleEnabled(tenantId, supportModule.manifest.key);
}

async function deliverSupportEmail(tenantId: string): Promise<void> {
  if (!await supportDeliveryAllowed(tenantId)) return;
  const config = serverConfig();
  const task = helpdeskSource.createEmailDeliveryTask({
    withTenantDb: (tenant, work) => {
      if (tenant !== tenantId) throw new Error("Support delivery tenant mismatch");
      return withTenantDb(tenantId as TenantId, work);
    },
    directory: {
      // Preference destination refs are active identity subject IDs, never
      // addresses. Resolve through the control-plane identity adapter only.
      resolveEmail: async (tenant, destinationRef) => {
        if (tenant !== tenantId || !await supportDeliveryAllowed(tenantId)) return null;
        const matches = (await identityGateway().listTenantMembers(tenantId as TenantId)).filter(member =>
          member.kind === "membership" && member.status === "active" && member.tenantId === tenantId && member.userId === destinationRef);
        return matches.length === 1 ? { tenantId, address: matches[0]!.email } : null;
      },
    },
    email: new SmtpEmailTransport({ host: config.IDENTITY_SMTP_HOST!, port: Number(config.IDENTITY_SMTP_PORT ?? 587), from: config.IDENTITY_SMTP_FROM ?? "",
      secure: Number(config.IDENTITY_SMTP_PORT ?? 587) === 465, requireTLS: config.NODE_ENV === "production",
      ...(config.IDENTITY_SMTP_USER ? { auth: { user: config.IDENTITY_SMTP_USER, pass: config.IDENTITY_SMTP_PASSWORD ?? "" } } : {}) }),
  });
  await task(tenantId, 25);
}

async function provision(job: TenantWorkerJob): Promise<void> {
  const db = controlPlanePool();
  const tenant = (await db.query<{ slug: string; display_name: string; data_region: "us" | "eu"; status: string }>(`select slug,display_name,data_region,status from tenants where tenant_id=$1`, [job.tenant_id])).rows[0];
  if (!tenant || tenant.status === "deleted") throw new Error("Tenant unavailable");
  if (tenant.status === "active") return;
  const provider = identityProviderFromEnv();
  if (provider === "local") throw new Error("Provisioning requires an organization identity adapter");
  const existing = await db.query(`select external_organization_id from identity_org_mappings where tenant_id=$1 and provider=$2`, [job.tenant_id, provider]);
  if (!existing.rows[0]) {
    const claim = await db.query(`update tenant_worker_jobs set input=input || '{"organizationAttempted":"true"}'::jsonb where id=$1 and not (input ? 'organizationAttempted') returning id`, [job.id]);
    if (!claim.rows[0]) throw new Error("Identity organization outcome requires reconciliation");
    const port = identityOrganizationPort();
    const organizationId = await port.createOrganization(tenant.display_name);
    // A crash before persistence stops future creation attempts until an operator reconciles the mapping.
    await db.query(`insert into identity_org_mappings(tenant_id,provider,external_organization_id) values ($1,$2,$3)`, [job.tenant_id, provider, organizationId]);
  }
  await executeProvisioningJob({ tenantId: job.tenant_id, tenantSlug: tenant.slug, dataRegion: tenant.data_region }, {
    provision: provisionTenantProject,
    inviteOwner: () => issueTenantOwnerInvite(job.tenant_id, job.input.ownerEmail!, job.actor),
    activate: () => activateProvisionedTenant({ tenantId: job.tenant_id, slug: tenant.slug, actor: job.actor }),
  });
}

async function grantOwner(job: TenantWorkerJob): Promise<void> {
  await withControlPlaneTransaction(async (client) => {
    const tenant = await client.query(`select status from tenants where tenant_id=$1 for update`, [job.tenant_id]);
    if (tenant.rows[0]?.status !== "active") throw new Error("Tenant unavailable");
    const invite = (await client.query<{ id: string; email: string; claimed_user_id: string; granted_at: Date | null; revoked_at: Date | null }>(`select * from tenant_owner_invites where id=$1 and tenant_id=$2 and consumed_at is not null for update`, [job.input.inviteId, job.tenant_id])).rows[0];
    if (!invite || invite.revoked_at) throw new Error("Invite revoked");
    if (invite.granted_at) return;
    const gateway = identityGateway(client);
    const members = await gateway.listTenantMembers(job.tenant_id as TenantId);
    if (members.some((member) => member.role === "tenant_owner" && member.status === "active" && member.userId !== invite.claimed_user_id)) throw new Error("Owner already exists");
    const member = members.find((member) => member.kind === "membership" && member.status === "active" && member.userId === invite.claimed_user_id && member.email.toLowerCase() === invite.email);
    if (!member) throw new Error("Accept the identity membership before claiming ownership");
    await gateway.setRole(member.membershipId, "tenant_owner");
    await queueMembershipSync(client, { tenantId: job.tenant_id, userId: invite.claimed_user_id, role: "tenant_owner", active: true });
    await client.query(`update tenant_owner_invites set granted_at=now() where id=$1`, [invite.id]);
    await workerAudit(client, { kind: "user", userId: invite.claimed_user_id }, job.tenant_id, "tenant.owner_bootstrapped", invite.id);
  });
}

export async function runTenantJob(id: string, signal?: AbortSignal): Promise<void> {
  const db = controlPlanePool();
  const job = (await db.query<TenantWorkerJob>(`select * from tenant_worker_jobs where id=$1`, [id])).rows[0];
  if (!job || job.status === "completed") return;
  // Session lock supplements Graphile's per-tenant queue for CLI/reconciliation callers.
  const lock = await db.connect();
  try {
    await lock.query(`select pg_advisory_lock(hashtextextended($1,0))`, [`tenant-worker:${job.tenant_id}`]);
    const current = (await db.query<TenantWorkerJob>(`update tenant_worker_jobs set status='running',attempts=attempts+1,last_error=null,updated_at=now() where id=$1 and status<>'completed' and attempts<5 returning *`, [id])).rows[0];
    if (!current) return;
    try {
      if (current.kind === "provision") await provision(current);
      else if (current.kind === "export") await runExport(current, signal);
      else if (current.kind === "erase") await eraseTenant(current);
      else await grantOwner(current);
      await db.query(`update tenant_worker_jobs set status='completed',updated_at=now() where id=$1`, [id]);
    } catch {
      await db.query(`update tenant_worker_jobs set status=case when attempts>=5 then 'failed' else 'pending' end,last_error='tenant_job_failed',updated_at=now() where id=$1`, [id]);
      throw new Error("tenant_job_failed");
    }
  } finally {
    await lock.query(`select pg_advisory_unlock(hashtextextended($1,0))`, [`tenant-worker:${job.tenant_id}`]).catch(() => undefined);
    lock.release();
  }
}

export const TENANT_WORKER_CRONTAB = "* * * * * support_ai_retention_dispatch ?max=5\n* * * * * helpdesk_dispatch ?max=5\n*/15 * * * * export_cleanup ?max=5\n* * * * * tenant_job_reconcile ?max=5\n* * * * * usage_export ?max=5\n* * * * * authorization_dispatch ?max=5\n* * * * * support_email_dispatch ?max=5\n" + CUSTOM_DOMAIN_CRONTAB;
export const tenantWorkerTasks: TaskList = {
  ...customDomainWorkerTasks,
  support_ai_retention_dispatch: async (_payload, helpers) => {
    const tenants = [...supportAiRetentionConfig().keys()].sort();
    const ordered = [...tenants.filter(id => id > supportRetentionCursor), ...tenants.filter(id => id <= supportRetentionCursor)];
    for (const tenantId of ordered.slice(0, SUPPORT_AI_RETENTION_LIMIT)) {
      await helpers.addJob("support_ticket_purge", { tenantId }, { jobKey: `support-retention:${tenantId}`, queueName: `tenant:${tenantId}`, maxAttempts: 5, jobKeyMode: "preserve_run_at" });
      supportRetentionCursor = tenantId;
    }
  },
  support_ticket_purge: async payload => {
    const tenantId = (payload as { tenantId?: unknown }).tenantId;
    if (typeof tenantId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) throw new Error("Invalid tenant reference");
    await purgeSupportAiTicketContent(tenantId);
  },
  tenant_job: async (payload, helpers) => {
    const id = (payload as { jobId?: unknown }).jobId;
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid job reference");
    await runTenantJob(id, helpers.abortSignal);
  },
  authorization_dispatch: async (_payload, helpers) => {
    if (!authorizationSyncEnabled()) return;
    const { rows } = await controlPlanePool().query<{ tenant_id: string }>(
      `select tenant_id from (
         select distinct on (tenant_id) tenant_id, available_at, lease_until
         from authorization_outbox where completed_at is null order by tenant_id, sequence
       ) heads where available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp())
       order by (tenant_id>$1) desc, tenant_id limit $2`, [authorizationCursor, DISPATCH_LIMIT]);
    for (const row of rows) {
      await helpers.addJob("authorization_outbox", { tenantId: row.tenant_id }, { jobKey: `authorization:${row.tenant_id}`, queueName: `tenant:${row.tenant_id}`, maxAttempts: 5, jobKeyMode: "preserve_run_at" });
      authorizationCursor = row.tenant_id;
    }
  },
  authorization_outbox: async (payload) => {
    if (!authorizationSyncEnabled()) return;
    const tenantId = (payload as { tenantId?: unknown }).tenantId;
    if (typeof tenantId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) throw new Error("Invalid tenant reference");
    const result = await runConfiguredAuthorizationOutbox(tenantId);
    if (result.failed) throw new Error("authorization_sync_failed");
  },
  support_email_dispatch: async (_payload, helpers) => {
    if (!supportModule || !serverConfig().IDENTITY_SMTP_HOST) return;
    const { rows } = await controlPlanePool().query<{ tenant_id: string }>(
      `select t.tenant_id from tenants t join module_catalog mc on mc.module_key=$1 and mc.runtime='native'
       left join tenant_modules tm on tm.tenant_id=t.tenant_id and tm.module_key=mc.module_key
       where t.status='active' and coalesce(tm.enabled, mc.ownership_scope='platform' and mc.enabled_by_default)
       order by (t.tenant_id>$2) desc, t.tenant_id limit $3`, [supportModule.manifest.key, supportCursor, DISPATCH_LIMIT]);
    for (const row of rows) {
      await helpers.addJob("support_email_delivery", { tenantId: row.tenant_id }, { jobKey: `support-email:${row.tenant_id}`, queueName: `tenant:${row.tenant_id}`, maxAttempts: 5, jobKeyMode: "preserve_run_at" });
      supportCursor = row.tenant_id;
    }
  },
  support_email_delivery: async (payload) => {
    const tenantId = (payload as { tenantId?: unknown }).tenantId;
    if (typeof tenantId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) throw new Error("Invalid tenant reference");
    await deliverSupportEmail(tenantId);
  },
  helpdesk_dispatch: async (_payload, helpers) => {
    const { rows } = await controlPlanePool().query<{ tenant_id: string }>(`select tenant_id from tenants where status='active' order by tenant_id`);
    for (const row of rows) await helpers.addJob("helpdesk_projection", { tenantId: row.tenant_id }, { jobKey: `helpdesk:${row.tenant_id}`, queueName: `tenant:${row.tenant_id}`, maxAttempts: 5, jobKeyMode: "unsafe_dedupe" });
  },
  helpdesk_projection: async (payload) => {
    const tenantId = (payload as { tenantId?: unknown }).tenantId;
    if (typeof tenantId !== "string") throw new Error("Invalid tenant reference");
    const state = await controlPlanePool().query(`select status from tenants where tenant_id=$1`, [tenantId]);
    if (state.rows[0]?.status !== "active") return;
    const result = await runHelpdeskProjectionPass(tenantId as TenantId);
    if (result.failed) throw new Error("helpdesk_projection_failed");
  },
  tenant_job_reconcile: async () => {
    // A process killed on its last attempt cannot update the application row.
    await controlPlanePool().query(`update tenant_worker_jobs j set status='failed',last_error='tenant_job_failed',updated_at=now() from graphile_worker.jobs q where q.key='tenant-job:' || j.id::text and q.attempts>=q.max_attempts and q.locked_at is null and j.status in ('running','pending')`);
  },
  usage_export: async (_payload, helpers) => {
    const result = await runUsageExport({ pool: controlPlanePool(), sink: configuredUsageExportSink() });
    helpers.logger.info("Usage export completed", result);
  },
  export_cleanup: async () => expireTenantExports(),
};
