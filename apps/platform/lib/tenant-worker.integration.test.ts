import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { makeWorkerUtils, runMigrations, runOnce, type JobHelpers } from "graphile-worker";
import { NeonProvisioner } from "@opentenant/provisioning";
import type { IdentitySession, MembershipId, TenantId, UserId } from "@opentenant/auth";
import { applyMigrations } from "@opentenant/migrations";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { loadControlPlaneMigrations } from "../../../tooling/migrations/src/local.mjs";
const fake = vi.hoisted(() => ({ invite: vi.fn(), removeMembership: vi.fn(), setRole: vi.fn(), listTenantMembers: vi.fn(), createOrganization: vi.fn() }));
vi.mock("./identity", () => ({ identityProviderFromEnv: () => "workos", identityGateway: () => fake, identityOrganizationPort: () => fake }));
import { enqueueTenantProvisioning, tenantJob, retryTenantJob } from "./tenant-worker-store";
import { tenantWorkerTasks } from "../workflows/tenant-worker";
import { issueTenantOwnerInvite, claimTenantOwnerInvite } from "./tenant-owner-invite";
import { requestTenantExport, changeTenantLifecycle } from "./tenant-lifecycle";
import { downloadTenantExport, LocalTenantExportSink } from "./tenant-export";
import { eraseTenant } from "./tenant-erase";
import { withTenantDb } from "./tenant-db";
import { createTicket } from "@opentenant/support";
import { providerFixture } from "../../../packages/testing/src/identity-fixtures";
import { PgAuditStore } from "@opentenant/database";
import { queueMembershipSync } from "./authz-lifecycle";
import { serverConfig } from "./server-config";
import { helpdeskSource, installedModules } from "../opentenant-modules";

const controlUrl = integrationDatabaseUrl("TENANT_WORKER_DATABASE_URL");
const tenantUrl = integrationDatabaseUrl("PROVISIONING_TENANT_DATABASE_URL");
const suite = controlUrl && tenantUrl ? describe : describe.skip;
suite("worker, owner bootstrap, export and erase on real Postgres", () => {
  if (!controlUrl || !tenantUrl) return;
  const control = new Pool({ connectionString: controlUrl });
  const actor = { kind: "installation_owner" as const, userId: "operator_example" };
  let directory: string;
  let tenantId: string;
  let jobId: string;
  let role = "tenant_member";
  const session: IdentitySession = { userId: "user_owner" as UserId, email: "owner@example.test", displayName: "Owner", activeTenantId: null, activeRole: null, permissions: [], isPlatformAdmin: false, expiresAt: new Date(Date.now() + 3600000) };
  const once = () => runOnce({ pgPool: control, taskList: tenantWorkerTasks, concurrency: 1, noHandleSignals: true });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "opentenant-wave2-"));
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", controlUrl);
    vi.stubEnv("TENANT_DB_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("NEON_API_KEY", "synthetic"); vi.stubEnv("NEON_ORG_ID", "synthetic");
    vi.stubEnv("TENANT_OWNER_INVITE_DIRECTORY", join(directory, "invites"));
    vi.stubEnv("TENANT_EXPORT_DIRECTORY", join(directory, "exports"));
    vi.stubEnv("USAGE_EXPORT_DIRECTORY", join(directory, "usage"));
    vi.stubEnv("USAGE_EXPORT_SINK", "file");
    await applyMigrations(control, await loadControlPlaneMigrations());
    await runMigrations({ pgPool: control });
    vi.spyOn(NeonProvisioner.prototype, "findProjectByName").mockResolvedValue(null);
    vi.spyOn(NeonProvisioner.prototype, "createTenantProject").mockResolvedValue({ projectId: "synthetic", connectionUri: tenantUrl, region: "aws-us-east-1" });
    vi.spyOn(NeonProvisioner.prototype, "getConnectionUri").mockResolvedValue(tenantUrl);
    fake.createOrganization.mockResolvedValue("organization_synthetic");
    fake.invite.mockResolvedValue("membership_invited" as MembershipId);
    fake.listTenantMembers.mockImplementation(async () => [{ kind: "membership", membershipId: "membership_owner", tenantId, userId: session.userId, email: session.email, role, status: "active" }, { kind: "invitation", membershipId: "membership_invited", tenantId, userId: null, email: session.email, role: "tenant_member", status: "invited" }]);
    fake.setRole.mockImplementation(async (_id, next) => { role = next; });
  }, 120000);
  afterAll(async () => {
    await control.end();
    const shared = globalThis as typeof globalThis & { [key: symbol]: Pool | undefined };
    await shared[Symbol.for("opentenant.control-plane-pool")]?.end(); delete shared[Symbol.for("opentenant.control-plane-pool")];
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  it("queues provider-free HTTP work and provisions from a real durable queue", async () => {
    const result = await enqueueTenantProvisioning({ slug: "worker-proof", displayName: "Worker Proof", dataRegion: "us", ownerEmail: session.email, actor });
    tenantId = result.tenantId; jobId = result.jobId;
    expect((await control.query(`select defaults, locked_keys, overrides from brand_policies where tenant_id=$1`, [tenantId])).rows[0]).toEqual({ defaults: {}, locked_keys: [], overrides: {} });
    expect(fake.createOrganization).not.toHaveBeenCalled();
    expect((await tenantJob(jobId, tenantId))?.status).toBe("pending");
    await once();
    expect((await tenantJob(jobId, tenantId))?.status).toBe("completed");
    expect((await control.query(`select status from tenants where tenant_id=$1`, [tenantId])).rows[0].status).toBe("active");
    expect(fake.invite).toHaveBeenCalledWith(expect.objectContaining({ role: "tenant_member" }));
    expect((await control.query(`select token_hash,expires_at>now()+interval '71 hours' as valid from tenant_owner_invites where tenant_id=$1`, [tenantId])).rows[0]).toMatchObject({ token_hash: expect.stringMatching(/^[a-f0-9]{64}$/), valid: true });
  }, 120000);
  it("reissues, revokes the prior token, rejects expiry, consumes exactly once, and audits the grant", async () => {
    const first = (await control.query(`select id from tenant_owner_invites where tenant_id=$1`, [tenantId])).rows[0].id;
    const old = JSON.parse(await readFile(join(directory, "invites", `${first}.json`), "utf8"));
    const replacement = await issueTenantOwnerInvite(tenantId, session.email, actor, { reissue: true });
    expect(fake.removeMembership).toHaveBeenCalledWith("membership_invited");
    const claim = JSON.parse(await readFile(replacement.file, "utf8"));
    // A real claimant has accepted the member invitation and is active in this tenant.
    const member: IdentitySession = { ...session, activeTenantId: tenantId as TenantId, activeRole: "tenant_member" };
    await expect(claimTenantOwnerInvite(tenantId, old.token, member)).rejects.toThrow("Invalid invite");
    await control.query(`update tenant_owner_invites set expires_at=now()-interval '1 second' where id=$1`, [replacement.inviteId]);
    await expect(claimTenantOwnerInvite(tenantId, claim.token, member)).rejects.toThrow("Invalid invite");
    await control.query(`update tenant_owner_invites set expires_at=now()+interval '1 hour' where id=$1`, [replacement.inviteId]);
    await expect(claimTenantOwnerInvite(tenantId, claim.token, { ...member, email: "other@example.test" })).rejects.toThrow("Invalid invite");
    // A session not active in this tenant is refused before the token is consumed.
    await expect(claimTenantOwnerInvite(tenantId, claim.token, session)).rejects.toThrow("Tenant membership required");
    await expect(claimTenantOwnerInvite(tenantId, claim.token, { ...member, activeTenantId: "tenant_other" as TenantId })).rejects.toThrow("Tenant membership required");
    const id = await claimTenantOwnerInvite(tenantId, claim.token, member);
    await expect(claimTenantOwnerInvite(tenantId, claim.token, member)).rejects.toThrow("Invalid invite");
    await once();
    expect((await tenantJob(id, tenantId))?.status).toBe("completed");
    expect(fake.setRole).toHaveBeenCalledWith("membership_owner", "tenant_owner");
    const audits = await control.query(`select action,detail from audit_events where tenant_id=$1`, [tenantId]);
    expect(audits.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["tenant.owner_invite_issued", "tenant.owner_invite_claimed", "tenant.owner_bootstrapped"]));
    expect(JSON.stringify(audits.rows)).not.toContain(claim.token);
    expect((await new PgAuditStore(control).verifyChain(tenantId)).intact).toBe(true);
    await expect(issueTenantOwnerInvite(tenantId, session.email, actor, { reissue: true })).rejects.toThrow("Owner already exists");
  }, 120000);
  it("schedules and idempotently applies a helpdesk projection per tenant", async () => {
    await withTenantDb(tenantId as TenantId, (client) => createTicket(client, { tenantId, actor, createdBy: session.userId, subject: "Synthetic", description: "Synthetic", category: "other" }));
    await control.query(`select graphile_worker.add_job('helpdesk_dispatch')`);
    await once();
    expect((await control.query(`select tenant_id from helpdesk_ticket_projection where tenant_id=$1`, [tenantId])).rowCount).toBe(1);
    await control.query(`select graphile_worker.add_job('helpdesk_dispatch')`);
    await once();
    expect((await control.query(`select tenant_id from helpdesk_ticket_projection where tenant_id=$1`, [tenantId])).rowCount).toBe(1);
  }, 120000);
  it("periodic authorization and email dispatch revive exhausted jobs without duplicating pending work", async () => {
    const previous = serverConfig();
    const settings = { AUTHZ_PROVIDER: "openfga", OPENFGA_API_URL: "http://127.0.0.1:1", OPENFGA_STORE_ID: "synthetic", OPENFGA_MODEL_ID: "synthetic", IDENTITY_SMTP_HOST: "127.0.0.1" } as const;
    const utils = await makeWorkerUtils({ pgPool: control });
    const queued: string[] = [];
    try {
      for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
      const client = await control.connect();
      try {
        await client.query("begin");
        await queueMembershipSync(client, { tenantId, userId: session.userId, role: "tenant_owner", active: true });
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
      const moduleKey = installedModules.modules.find(module => module.services?.helpdesk === helpdeskSource)!.manifest.key;
      await control.query(`insert into tenant_modules(tenant_id,module_key,module_version,enabled)
        select $1,module_key,version,true from module_catalog where module_key=$2
        on conflict (tenant_id,module_key) do update set enabled=true`, [tenantId, moduleKey]);
      const helpers = { addJob: utils.addJob } as JobHelpers;
      for (const [task, key] of [["authorization_dispatch", `authorization:${tenantId}`], ["support_email_dispatch", `support-email:${tenantId}`]] as const) {
        await tenantWorkerTasks[task]!({}, helpers);
        const first = (await control.query("select id,attempts from graphile_worker.jobs where key=$1", [key])).rows[0];
        expect(first).toBeDefined();
        queued.push(first.id);
        await tenantWorkerTasks[task]!({}, helpers);
        expect((await control.query("select id from graphile_worker.jobs where key=$1", [key])).rows).toEqual([{ id: first.id }]);
        await utils.permanentlyFailJobs([first.id], "synthetic failure");
        expect((await control.query("select attempts=max_attempts as exhausted from graphile_worker.jobs where key=$1", [key])).rows[0].exhausted).toBe(true);
        await tenantWorkerTasks[task]!({}, helpers);
        const revived = (await control.query("select id,attempts,last_error from graphile_worker.jobs where key=$1", [key])).rows;
        expect(revived).toEqual([expect.objectContaining({ attempts: 0, last_error: null })]);
        queued.push(revived[0].id);
      }
    } finally {
      await utils.completeJobs(queued);
      await utils.release();
      for (const key of Object.keys(settings) as (keyof typeof settings)[]) vi.stubEnv(key, previous[key]);
    }
  }, 120000);
  it("exports through the restricted tenant role and expires download authority", async () => {
    const id = await requestTenantExport(tenantId, actor);
    await once();
    expect((await tenantJob(id, tenantId))?.status).toBe("completed");
    const data = await downloadTenantExport(tenantId, id, actor);
    expect(data).not.toBeNull();
    const downloaded = Buffer.from(await new Response(data!.body).arrayBuffer());
    expect(downloaded.length).toBe(data!.byteLength);
    expect(downloaded.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    const { gunzipSync } = await import("node:zlib");
    const unpacked = gunzipSync(downloaded);
    expect(unpacked.includes(Buffer.from("control.tenant_databases.json"))).toBe(true);
    expect(unpacked.includes(Buffer.from(tenantId))).toBe(true);
    // The full downloaded archive must be the one produced for this job.
    expect(downloaded).toEqual(await readFile(join(directory, "exports", `${id}.tar.gz`)));
    const archive = join(directory, "exports", `${id}.tar.gz`);
    const metadata = JSON.parse((await promisify(execFile)("tar", ["-xOzf", archive, "control.tenant_databases.json"])).stdout);
    expect(metadata[0].tenant_id).toBe(tenantId);
    expect(metadata[0]).not.toHaveProperty("encrypted_connection");
    const invites = JSON.parse((await promisify(execFile)("tar", ["-xOzf", archive, "control.tenant_owner_invites.json"])).stdout);
    expect(invites[0]).not.toHaveProperty("token_hash");
    expect(JSON.parse((await promisify(execFile)("tar", ["-xOzf", archive, "control.model_stream_terminal_events.json"])).stdout)).toEqual([]);
    expect(await downloadTenantExport("tenant_other", id, actor)).toBeNull();
    await control.query(`update tenant_export_archives set expires_at=now()-interval '1 second' where id=$1`, [id]);
    expect(await downloadTenantExport(tenantId, id, actor)).toBeNull();
  }, 120000);
  it("reconciles a process killed on its final attempt and permits an audited retry", async () => {
    const id = await requestTenantExport(tenantId, actor);
    await control.query(`update tenant_worker_jobs set status='running' where id=$1`, [id]);
    await control.query(`update graphile_worker._private_jobs set attempts=max_attempts,locked_at=null,locked_by=null where key=$1`, [`tenant-job:${id}`]);
    await control.query(`select graphile_worker.add_job('tenant_job_reconcile')`);
    await once();
    expect((await tenantJob(id, tenantId))?.status).toBe("failed");
    await retryTenantJob(tenantId, id, actor);
    await once();
    expect((await tenantJob(id, tenantId))?.status).toBe("completed");
  }, 120000);
  it("suspends/resumes, audits retries, and erases only after retention with content-free final evidence", async () => {
    await control.query(`insert into usage_metric_definitions(tenant_id,metric_id,unit,description) values ($1,'requests','count','Synthetic')`, [tenantId]);
    await control.query(`insert into exact_usage_events(event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint) values ('00000000000000000000000000000001',$1,'requests',1,now(),'synthetic','synthetic')`, [tenantId]);
    await control.query(`insert into exact_usage_events(event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint,correction_of_event_id,correction_reason) select '00000000000000000000000000000002',$1,'requests',-1,occurred_at,'synthetic','synthetic','00000000000000000000000000000001','Synthetic' from exact_usage_events where event_id='00000000000000000000000000000001'`, [tenantId]);
    await control.query(`insert into tenants(tenant_id,slug,display_name,status,data_region) values ('tenant_meter_peer','meter-peer','Meter Peer','active','us')`);
    await control.query(`insert into usage_metric_definitions(tenant_id,metric_id,unit,description) values ('tenant_meter_peer','requests','count','Synthetic')`);
    await control.query(`insert into exact_usage_events(event_id,tenant_id,metric_id,quantity,occurred_at,source_reference,fingerprint) values ('00000000000000000000000000000003','tenant_meter_peer','requests',1,now(),'synthetic','synthetic')`);
    await control.query(`select graphile_worker.add_job('usage_export')`);
    await once();
    expect((await control.query(`select count(*)::int as count from usage_export_receipts`)).rows[0].count).toBe(3);
    await control.query(`update usage_export_cursors set last_event_id='00000000000000000000000000000001'`);
    await control.query(`insert into oauth_consumed_states(state_hash,tenant_id) values ('synthetic',$1)`, [tenantId]);
    await control.query(`insert into oauth_consumed_states(state_hash,tenant_id) values ('other','tenant_other')`);
    await changeTenantLifecycle(tenantId, "suspend", actor);
    expect((await control.query(`select status from tenants where tenant_id=$1`, [tenantId])).rows[0].status).toBe("suspended");
    await changeTenantLifecycle(tenantId, "resume", actor);
    const id = await changeTenantLifecycle(tenantId, "delete", actor);
    const job = (await tenantJob(id!, tenantId))!;
    const eraser = { deleteProject: vi.fn() };
    await expect(eraseTenant(job, eraser)).rejects.toThrow("retention");
    expect(eraser.deleteProject).not.toHaveBeenCalled();
    await control.query(`update tenant_worker_jobs set status='failed' where id=$1`, [id]);
    await retryTenantJob(tenantId, id!, actor);
    expect((await control.query(`select action from audit_events where tenant_id=$1 and action='tenant.job_retried'`, [tenantId])).rowCount).toBe(2);
    await control.query(`update tenants set erase_after=now()-interval '1 second' where tenant_id=$1`, [tenantId]);
    const sink = new LocalTenantExportSink();
    const remove = vi.spyOn(sink, "remove").mockRejectedValueOnce(new Error("synthetic sink outage"));
    await expect(eraseTenant(job, eraser, sink)).rejects.toThrow("sink outage");
    remove.mockRestore();
    await eraseTenant(job, eraser, sink);
    await eraseTenant(job, eraser, sink);
    expect(eraser.deleteProject).toHaveBeenCalledExactlyOnceWith("synthetic");
    expect((await control.query(`select * from tenants where tenant_id=$1`, [tenantId])).rowCount).toBe(0);
    expect((await control.query(`select event_id from usage_export_receipts`)).rows).toEqual([{ event_id: "00000000000000000000000000000003" }]);
    expect((await control.query(`select last_event_id from usage_export_cursors`)).rows).toEqual([{ last_event_id: null }]);
    expect((await control.query(`select * from oauth_consumed_states where tenant_id=$1`, [tenantId])).rowCount).toBe(0);
    expect((await control.query(`select * from oauth_consumed_states where tenant_id='tenant_other'`)).rowCount).toBe(1);
    expect((await control.query(`select * from audit_events where tenant_id=$1`, [tenantId])).rowCount).toBe(0);
    const audit = (await control.query(`select tenant_id,action,subject,detail from audit_events where action='tenant.erased'`)).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tenant_id: null, detail: { erased: true } });
    expect(JSON.stringify(audit)).not.toContain(tenantId);
    expect((await new PgAuditStore(control).verifyChain(null)).intact).toBe(true);
  }, 120000);
  it.each(["workos", "clerk"] as const)("claims and elevates an owner through the hardened %s gateway", async (provider) => {
    const f = providerFixture(provider, `tenant_${provider}` as TenantId);
    await control.query(`insert into tenants(tenant_id,slug,display_name,status,data_region) values ($1,$2,'Owner Proof','active','us')`, [f.tenantId, `owner-${provider}`]);
    fake.listTenantMembers.mockImplementation(id => f.gateway.listTenantMembers(id));
    fake.setRole.mockImplementation((id, next) => f.gateway.setRole(id, next));
    const ownerSession: IdentitySession = { ...session, userId: f.userId, email: "member0@example.test", activeTenantId: f.tenantId, activeRole: "tenant_member" };
    await expect(f.gateway.invite({ tenantId: f.tenantId, email: ownerSession.email, role: "tenant_owner", invitedBy: f.userId })).rejects.toThrow();
    const invite = await issueTenantOwnerInvite(f.tenantId, ownerSession.email, actor, { gateway: f.gateway });
    expect((await f.gateway.listTenantMembers(f.tenantId)).some(m => m.role === "tenant_owner")).toBe(false);
    const { token } = JSON.parse(await readFile(invite.file, "utf8"));
    const id = await claimTenantOwnerInvite(f.tenantId, token, ownerSession);
    await expect(claimTenantOwnerInvite(f.tenantId, token, ownerSession)).rejects.toThrow("Invalid invite");
    await once();
    expect((await tenantJob(id, f.tenantId))?.status).toBe("completed");
    expect(await f.gateway.listTenantMembers(f.tenantId)).toContainEqual(expect.objectContaining({ userId: f.userId, role: "tenant_owner", status: "active" }));
    expect((await control.query(`select granted_at is not null as granted from tenant_owner_invites where id=$1`, [invite.inviteId])).rows[0].granted).toBe(true);
    expect((await new PgAuditStore(control).verifyChain(f.tenantId)).intact).toBe(true);
  }, 120000);

});
