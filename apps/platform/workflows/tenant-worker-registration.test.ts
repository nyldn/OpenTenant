import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobHelpers } from "graphile-worker";
import type { TenantId, TenantMember } from "@opentenant/auth";
import type { TenantWorkerJob } from "../lib/tenant-worker-store";
import { TENANT_WORKER_CRONTAB, tenantWorkerTasks } from "./tenant-worker";
import { runConfiguredAuthorizationOutbox } from "../lib/authz-lifecycle";

const state = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), members: vi.fn(), setRole: vi.fn(), factory: vi.fn(), deliver: vi.fn(), tenantDb: vi.fn(), enabled: vi.fn(), export: vi.fn(), audit: vi.fn() }));
vi.mock("../lib/control-plane", () => ({ controlPlanePool: () => ({ query: state.query, connect: async () => state }), withControlPlaneTransaction: async (work: (client: unknown) => Promise<unknown>) => work(state) }));
vi.mock("../lib/identity", () => ({ identityGateway: () => ({ listTenantMembers: state.members, setRole: state.setRole }), identityProviderFromEnv: () => "local", identityOrganizationPort: vi.fn() }));
vi.mock("../lib/tenant-db", () => ({ withTenantDb: state.tenantDb }));
vi.mock("../lib/module-registry", () => ({ nativeModuleEnabled: state.enabled }));
vi.mock("../lib/tenant-export", () => ({ exportTenant: state.export, expireTenantExports: vi.fn() }));
vi.mock("../lib/tenant-worker-store", () => ({ workerAudit: state.audit }));
vi.mock("../lib/authz-lifecycle", async original => ({ ...await original<object>(), runConfiguredAuthorizationOutbox: vi.fn() }));
vi.mock("../opentenant-modules", () => {
  const helpdesk = { createEmailDeliveryTask: state.factory };
  const support = { manifest: { key: "example", runtime: "native" }, services: { helpdesk } };
  return { installedModules: { modules: [support], get: () => support }, helpdeskSource: helpdesk };
});
vi.mock("@opentenant/notifications/smtp", () => ({ SmtpEmailTransport: class { send = vi.fn(); } }));

const jobId = "00000000-0000-4000-8000-000000000001";
const job: TenantWorkerJob = { id: jobId, tenant_id: "ten_a", kind: "owner_grant", status: "pending", attempts: 0, input: { inviteId: "invite_a" }, result: {}, run_at: new Date(), last_error: null, actor: { kind: "user", userId: "user_a" } };
const member = { kind: "membership", membershipId: "membership_a", userId: "user_a", tenantId: "ten_a" as TenantId, email: "member@example.test", role: "tenant_member", status: "active" } as TenantMember;
const helpers = () => ({ addJob: vi.fn(), logger: { info: vi.fn() } } as unknown as JobHelpers);
function configured(enabled: boolean) {
  vi.stubEnv("AUTHZ_PROVIDER", enabled ? "openfga" : "in-process");
  vi.stubEnv("OPENFGA_API_URL", "http://127.0.0.1:1"); vi.stubEnv("OPENFGA_STORE_ID", "synthetic"); vi.stubEnv("OPENFGA_MODEL_ID", "synthetic");
}
beforeEach(() => {
  vi.clearAllMocks();
  configured(false); vi.stubEnv("IDENTITY_SMTP_HOST", "");
  state.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("from tenant_worker_jobs") || sql.includes("returning *")) return { rows: [job] };
    if (sql.includes("select status from tenants")) return { rows: [{ status: "active" }] };
    if (sql.includes("from tenant_owner_invites")) return { rows: [{ id: "invite_a", email: "member@example.test", claimed_user_id: "user_a" }] };
    if (sql.includes("insert into authorization_sync_streams")) return { rows: [{ next_sequence: "1" }] };
    return { rows: [] };
  });
  state.members.mockResolvedValue([member]); state.enabled.mockResolvedValue(true);
  state.factory.mockReturnValue(state.deliver); state.deliver.mockResolvedValue(1);
});
afterEach(() => vi.unstubAllEnvs());

describe("authorization worker registration", () => {
  it("registers a minute crontab and bounded head selection with expired lease recovery", async () => {
    configured(true);
    expect(TENANT_WORKER_CRONTAB).toContain("* * * * * authorization_dispatch ?max=5");
    state.query.mockResolvedValue({ rows: [{ tenant_id: "ten_a" }, { tenant_id: "ten_b" }] });
    const h = helpers();
    await tenantWorkerTasks.authorization_dispatch!({}, h);
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining("distinct on (tenant_id)"), [expect.any(String), 25]);
    const sql = state.query.mock.calls[0]![0];
    expect(sql).toContain("completed_at is null"); expect(sql).toContain("order by tenant_id, sequence");
    expect(sql).toContain("available_at<=clock_timestamp()"); expect(sql).toContain("lease_until<=clock_timestamp()");
    expect(h.addJob).toHaveBeenCalledTimes(2);
    expect(h.addJob).toHaveBeenCalledWith("authorization_outbox", { tenantId: "ten_a" }, expect.objectContaining({ jobKey: "authorization:ten_a", queueName: "tenant:ten_a", jobKeyMode: "preserve_run_at" }));
    vi.mocked(runConfiguredAuthorizationOutbox).mockResolvedValue({ delivered: 1, failed: 0, noop: false });
    await tenantWorkerTasks.authorization_outbox!({ tenantId: "ten_a" }, h);
    expect(runConfiguredAuthorizationOutbox).toHaveBeenCalledWith("ten_a");
    vi.mocked(runConfiguredAuthorizationOutbox).mockResolvedValue({ delivered: 0, failed: 1, noop: false });
    await expect(tenantWorkerTasks.authorization_outbox!({ tenantId: "ten_a" }, h)).rejects.toThrow("authorization_sync_failed");
  });
  it("does no database, provider or queue work by default", async () => {
    const h = helpers();
    await tenantWorkerTasks.authorization_dispatch!({}, h);
    await tenantWorkerTasks.authorization_outbox!({ tenantId: "ten_a" }, h);
    expect(state.query).not.toHaveBeenCalled(); expect(h.addJob).not.toHaveBeenCalled(); expect(runConfiguredAuthorizationOutbox).not.toHaveBeenCalled();
  });
  it.each([false, true])("owner grant queues on the locked mutation client only when enabled=%s", async enabled => {
    configured(enabled);
    await tenantWorkerTasks.tenant_job!({ jobId }, helpers());
    expect(state.setRole).toHaveBeenCalledWith("membership_a", "tenant_owner");
    const calls = state.query.mock.calls;
    const outbox = calls.filter(([sql]) => sql.includes("insert into authorization_outbox"));
    expect(outbox).toHaveLength(enabled ? 1 : 0);
    if (enabled) {
      expect(JSON.parse(outbox[0]![1][6])).toEqual({ kind: "membership", userId: "user_a", role: "tenant_owner", active: true });
      expect(state.setRole.mock.invocationCallOrder[0]).toBeLessThan(state.query.mock.invocationCallOrder[calls.indexOf(outbox[0]!) ]!);
      expect(state.audit).toHaveBeenCalledWith(state, expect.anything(), "ten_a", "tenant.owner_bootstrapped", "invite_a");
    }
  });
  it("does not queue a failed or already granted ownership mutation", async () => {
    configured(true); state.setRole.mockRejectedValueOnce(new Error("denied"));
    await expect(tenantWorkerTasks.tenant_job!({ jobId }, helpers())).rejects.toThrow("tenant_job_failed");
    expect(state.query.mock.calls.some(([sql]) => sql.includes("insert into authorization_outbox"))).toBe(false);
  });
});

describe("support delivery registration", () => {
  beforeEach(() => vi.stubEnv("IDENTITY_SMTP_HOST", "127.0.0.1"));
  it("registers periodic bounded dispatch only for active entitled tenants", async () => {
    expect(TENANT_WORKER_CRONTAB).toContain("* * * * * support_email_dispatch ?max=5");
    state.query.mockResolvedValue({ rows: [{ tenant_id: "ten_a" }] });
    const h = helpers();
    await tenantWorkerTasks.support_email_dispatch!({}, h);
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining("t.status='active'"), ["example", expect.any(String), 25]);
    expect(state.query.mock.calls[0]![0]).toContain("coalesce(tm.enabled");
    expect(h.addJob).toHaveBeenCalledWith("support_email_delivery", { tenantId: "ten_a" }, expect.objectContaining({ queueName: "tenant:ten_a", jobKey: "support-email:ten_a", jobKeyMode: "preserve_run_at" }));
  });
  it("binds the directory and tenant transactions, and bounds the actual batch", async () => {
    await tenantWorkerTasks.support_email_delivery!({ tenantId: "ten_a" }, helpers());
    expect(state.deliver).toHaveBeenCalledWith("ten_a", 25);
    const options = state.factory.mock.calls[0]![0];
    expect(options.email.send).toBeTypeOf("function");
    const work = vi.fn();
    await options.withTenantDb("ten_a", work);
    expect(state.tenantDb).toHaveBeenCalledWith("ten_a", work);
    expect(() => options.withTenantDb("ten_b", work)).toThrow("tenant mismatch");
    expect(await options.directory.resolveEmail("ten_a", "user_a")).toEqual({ tenantId: "ten_a", address: "member@example.test" });
    state.members.mockClear();
    expect(await options.directory.resolveEmail("ten_b", "user_a")).toBeNull();
    expect(state.members).not.toHaveBeenCalled();
    expect(await options.directory.resolveEmail("ten_a", "member@example.test")).toBeNull();
    state.members.mockResolvedValue([{ ...member, tenantId: "ten_b" }]);
    expect(await options.directory.resolveEmail("ten_a", "user_a")).toBeNull();
    state.members.mockResolvedValue([{ ...member, status: "invited" }]);
    expect(await options.directory.resolveEmail("ten_a", "user_a")).toBeNull();
    state.members.mockResolvedValue([{ ...member, status: "suspended" }]);
    expect(await options.directory.resolveEmail("ten_a", "user_a")).toBeNull();
  });
  it.each(["suspended", "deleted"])("does no delivery for a %s tenant", async status => {
    state.query.mockResolvedValue({ rows: [{ status }] });
    await tenantWorkerTasks.support_email_delivery!({ tenantId: "ten_a" }, helpers());
    expect(state.factory).not.toHaveBeenCalled();
  });
  it("rechecks entitlement and active state before resolving a queued recipient", async () => {
    await tenantWorkerTasks.support_email_delivery!({ tenantId: "ten_a" }, helpers());
    const options = state.factory.mock.calls[0]![0];
    state.enabled.mockResolvedValue(false);
    expect(await options.directory.resolveEmail("ten_a", "user_a")).toBeNull();
    expect(state.members).not.toHaveBeenCalled();
  });
  it("leaves SMTP disabled without opening a tenant database or consuming the queue", async () => {
    vi.stubEnv("IDENTITY_SMTP_HOST", "");
    const h = helpers();
    await tenantWorkerTasks.support_email_dispatch!({}, h);
    await tenantWorkerTasks.support_email_delivery!({ tenantId: "ten_a" }, h);
    expect(state.query).not.toHaveBeenCalled(); expect(state.factory).not.toHaveBeenCalled(); expect(h.addJob).not.toHaveBeenCalled();
  });
});

it("registers export cleanup and forwards the worker abort signal to archive cleanup", async () => {
  const controller = new AbortController();
  const h = { ...helpers(), abortSignal: controller.signal };
  state.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("tenant_worker_jobs") ? [{ ...job, kind: "export" }] : [] }));
  state.export.mockImplementationOnce(async (_job, _sink, options) => { expect(options.signal).toBe(controller.signal); controller.abort(); options.signal.throwIfAborted(); });
  await expect(tenantWorkerTasks.tenant_job!({ jobId }, h)).rejects.toThrow("tenant_job_failed");
  expect(state.export).toHaveBeenCalledOnce();
  expect(TENANT_WORKER_CRONTAB).toContain("*/15 * * * * export_cleanup ?max=5");
  expect(tenantWorkerTasks.export_cleanup).toBeTypeOf("function");
});

it("schedules bounded tenant retention fairly and exposes the post-ticket-purge job", async () => {
  const urls = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`tenant_${String(i).padStart(2, "0")}`, `postgresql://operator:synthetic@db.example.test/tenant_${i}`]));
  vi.stubEnv("SUPPORT_AI_RETENTION_DATABASE_URLS", JSON.stringify(urls));
  expect(TENANT_WORKER_CRONTAB).toContain("* * * * * support_ai_retention_dispatch ?max=5");
  const h = helpers();
  await tenantWorkerTasks.support_ai_retention_dispatch!({}, h);
  expect(h.addJob).toHaveBeenCalledTimes(25);
  expect(h.addJob).toHaveBeenCalledWith("support_ticket_purge", { tenantId: "tenant_00" }, expect.objectContaining({ queueName: "tenant:tenant_00", jobKeyMode: "preserve_run_at" }));
  vi.mocked(h.addJob).mockClear();
  await tenantWorkerTasks.support_ai_retention_dispatch!({}, h);
  expect(vi.mocked(h.addJob).mock.calls[0]?.[1]).toEqual({ tenantId: "tenant_25" });
  vi.stubEnv("SUPPORT_AI_RETENTION_DATABASE_URLS", "");
  vi.mocked(h.addJob).mockClear();
  await tenantWorkerTasks.support_ai_retention_dispatch!({}, h);
  await tenantWorkerTasks.support_ticket_purge!({ tenantId: "tenant_a" }, h);
  expect(h.addJob).not.toHaveBeenCalled();
  await expect(tenantWorkerTasks.support_ticket_purge!({ tenantId: "../foreign" }, h)).rejects.toThrow("Invalid tenant reference");
});
