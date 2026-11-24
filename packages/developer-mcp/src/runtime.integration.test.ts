import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PgAdmissionStore } from "@opentenant/database";
import { IsolatedSandboxAdapter } from "@opentenant/sandbox/testing";
import { developerMcpConfig } from "./config";
import { createDeveloperMcpHandler, exchangeDeveloperPreview } from "./runtime";
import { DeveloperMcpStore, secretDigest, type RuntimeAuthority } from "./runtime-store";
import { migrateControl, proofDatabase } from "./testing/postgres";
const suite = process.env.ADMIN_DATABASE_URL ? describe : describe.skip;
const token = "test_access_token_".repeat(4), projectId = "a".repeat(32);
const args = { templateId: "opentenant/module-service@1", label: "Example" };
const config = developerMcpConfig({ DEVELOPER_MCP_ENABLED: "true", DEVELOPER_MCP_RESOURCE_URL: "https://tenant.example.test/api/mcp/developer", DEVELOPER_MCP_AUTHORIZATION_SERVER: "https://auth.example.test/" });
function request(options: { token?: string | null; confirmation?: string; name?: string; args?: unknown; key?: string; method?: string } = {}) {
  const method = options.method ?? "tools/call";
  return new Request(config.resource, { method: "POST", headers: {
    "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method,
    ...(method === "tools/call" ? { "Mcp-Name": options.name ?? "workspace.create" } : {}),
    ...(options.token === null ? {} : { Authorization: `Bearer ${options.token ?? token}` }),
    "Idempotency-Key": options.key ?? "request_idempotency_001", ...(options.confirmation ? { "x-mcp-confirmation": options.confirmation } : {}),
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} }, ...(method === "tools/call" ? { name: options.name ?? "workspace.create", arguments: options.args ?? args } : {}) } }) });
}
suite("Developer MCP composed PostgreSQL + local stub sandbox", { timeout: 30_000 }, () => {
  let db: Awaited<ReturnType<typeof proofDatabase>>, store: DeveloperMcpStore, authority: RuntimeAuthority;
  const files = new Map<string, Uint8Array>();
  const killed = vi.fn(async () => undefined);
  const created = vi.fn(async () => ({ id: "local-stub", write: async (path: string, content: Uint8Array) => { files.set(path, content); },
    run: async () => ({ exitCode: 0, stdout: "HOST_SECRET=must-not-escape", stderr: "" }), read: async (path: string) => files.get(path)!, kill: killed }));
  const sandbox = new IsolatedSandboxAdapter("microsandbox", { create: created }, false);
  const membershipActive = vi.fn(async () => true);
  const runtime = () => ({ config, store, membershipActive, sandbox: () => sandbox, tenant: async () => "tenant_mcp" });
  const call = (req: Request) => createDeveloperMcpHandler(runtime())(req);
  beforeAll(async () => {
    db = await proofDatabase(process.env.ADMIN_DATABASE_URL); await migrateControl(db.pool); store = new DeveloperMcpStore(db.pool);
    await db.pool.query("insert into tenants(tenant_id,slug,display_name,status,data_region) values('tenant_mcp','mcp','MCP','active','us'),('tenant_foreign','foreign','Foreign','active','us')");
    await db.pool.query("insert into developer_mcp.projects(id,tenant_id,user_id,client_id,profile,consent_scopes,active) values($1,'tenant_mcp','user_mcp','client_mcp','developer.builder@1',array['module.dev.workspace.create','module.dev.preview.open'],true)", [projectId]);
    await db.pool.query("insert into developer_mcp.tokens(digest,project_id,audience,scopes,expires_at) values($1,$2,$3,array['module.dev.workspace.create','module.dev.preview.open'],now()+interval '10 minutes')", [secretDigest(token), projectId, config.resource]);
  }, 60_000);
  beforeEach(async () => {
    membershipActive.mockResolvedValue(true);
    killed.mockClear(); created.mockClear(); files.clear();
    await db.pool.query("delete from developer_mcp.previews; delete from developer_mcp.jobs; delete from developer_mcp.confirmations; delete from admission_idempotency_records; delete from admission_leases; delete from admission_windows; delete from admission_policies");
    await db.pool.query("update developer_mcp.tokens set expires_at=now()+interval '10 minutes',revoked=false; update developer_mcp.projects set tenant_id='tenant_mcp',active=true");
    await store.setSwitch("installation", true, { kind: "installation_owner", userId: "owner" }, "local proof");
    await store.setSwitch("tenant:tenant_mcp", true, { kind: "installation_owner", userId: "owner" }, "local proof");
    authority = (await store.transaction((client) => store.authority(client, token, config.resource, "tenant_mcp")))!;
  });
  afterAll(async () => { await db?.close(); }, 60_000);
  it("denies unauthenticated calls before sandbox work and audits denial", async () => {
    expect((await call(request({ token: null }))).status).toBe(401); expect(created).not.toHaveBeenCalled();
    expect((await db.pool.query("select detail from audit_events where action='developer_mcp.call' order by sequence desc limit 1")).rows[0].detail.outcome).toBe("unauthenticated");
  });
  it("denies revoked membership independently of project and token state", async () => {
    membershipActive.mockResolvedValue(false);
    expect((await call(request())).status).toBe(401); expect(created).not.toHaveBeenCalled();
  });
  it("denies wrong-tenant authority indistinguishably", async () => {
    await db.pool.query("update developer_mcp.projects set tenant_id='tenant_foreign'");
    expect((await call(request())).status).toBe(401); expect(created).not.toHaveBeenCalled();
  });
  it("denies expired authority", async () => {
    await db.pool.query("update developer_mcp.tokens set expires_at=now()-interval '1 second'");
    expect((await call(request())).status).toBe(401); expect(created).not.toHaveBeenCalled();
  });
  it("denies the independent installation and tenant kill switches", async () => {
    await store.setSwitch("installation", false, { kind: "installation_owner", userId: "owner" }, "test stop");
    expect((await call(request())).status).toBe(403);
    await store.setSwitch("installation", true, { kind: "installation_owner", userId: "owner" }, "test start");
    await store.setSwitch("tenant:tenant_mcp", false, { kind: "installation_owner", userId: "owner" }, "test stop");
    expect((await call(request())).status).toBe(403); expect(created).not.toHaveBeenCalled();
  });
  it("requires one-time confirmation for mutation and writes authorization audit rows", async () => {
    expect((await call(request())).status).toBe(403); expect(created).not.toHaveBeenCalled();
    const rows = (await db.pool.query("select detail from audit_events where action='developer_mcp.authorization'")).rows;
    expect(rows.at(-1).detail).toMatchObject({ authorizationDecision: "allow", toolName: "workspace.create", clientId: "client_mcp" });
    expect(rows.at(-1).detail.currentDigest).toMatch(/^sha256:/);
    expect((await store.audit.verifyChain("tenant_mcp")).intact).toBe(true);
  });
  it("enforces admission rate limit", async () => {
    for (let index = 0; index < 10; index++) expect((await call(request({ key: `request_idempotency_${index}` }))).status).toBe(403);
    expect((await call(request({ key: "request_idempotency_limit" }))).status).toBe(429); expect(created).not.toHaveBeenCalled();
  });
  it("rejects forged metadata, wrong audience, prefix tool names and changed confirmation input", async () => {
    const confirmation = await store.confirm(authority, args, { userId: "user_mcp", tenantId: "tenant_mcp" });
    expect((await call(request({ confirmation, args: { ...args, label: "Changed" } }))).status).toBe(403);
    expect((await call(request({ name: " workspace.create" }))).status).toBe(400);
    expect((await call(request({ args: { ...args, tenantId: "tenant_foreign" } }))).status).toBe(400);
    await db.pool.query("update developer_mcp.tokens set audience='https://foreign.example.test/'");
    expect((await call(request())).status).toBe(401);
    await db.pool.query("update developer_mcp.tokens set audience=$1", [config.resource]);
  });
  it("denies concurrent work under the shared admission policy", async () => {
    const admission = new PgAdmissionStore(db.pool);
    const held = await admission.admit({ scope: { tenantId: "tenant_mcp", principalId: "user_mcp", operation: "developer-mcp" }, idempotencyKey: randomUUID(), fingerprint: "held", sizeBytes: 1 },
      { maxRequests: 10, windowMs: 60_000, maxConcurrent: 1, leaseMs: 40_000, idempotencyTtlMs: 60_000, maxIdempotencyEntriesPerScope: 50, maxSizeBytes: 8192 });
    expect(held.admitted).toBe(true);
    expect((await call(request())).status).toBe(429); expect(created).not.toHaveBeenCalled();
    if (held.admitted) await admission.release({ scope: held.lease.scope, leaseId: held.lease.leaseId });
  });
  it("denies expired and cross-client confirmations", async () => {
    const confirmation = await store.confirm(authority, args, { userId: "user_mcp", tenantId: "tenant_mcp" });
    await db.pool.query("update developer_mcp.confirmations set expires_at=now()-interval '1 second'");
    expect((await call(request({ confirmation }))).status).toBe(403);
    await db.pool.query("update developer_mcp.confirmations set expires_at=now()+interval '1 minute',client_id='foreign_client'");
    expect((await call(request({ confirmation, key: "request_other_client" }))).status).toBe(403); expect(created).not.toHaveBeenCalled();
  });
  it("rolls confirmation consumption and job creation back when audit append fails", async () => {
    const confirmation = await store.confirm(authority, args, { userId: "user_mcp", tenantId: "tenant_mcp" });
    const original = store.event.bind(store);
    const fault = vi.spyOn(store, "event").mockImplementation(async (client, current, outcome, job) => {
      if (outcome === "started") throw new Error("synthetic audit outage");
      return original(client, current, outcome, job);
    });
    try {
      expect((await call(request({ confirmation }))).status).toBe(503);
      expect((await db.pool.query("select consumed from developer_mcp.confirmations")).rows[0].consumed).toBe(false);
      expect((await db.pool.query("select count(*) from developer_mcp.jobs")).rows[0].count).toBe("0");
      expect(created).not.toHaveBeenCalled();
    } finally { fault.mockRestore(); }
  });
  it("scaffolds in a local stub, tears down, audits and returns a tenant/user/client-bound single-use preview", async () => {
    const confirmation = await store.confirm(authority, args, { userId: "user_mcp", tenantId: "tenant_mcp" });
    const response = await call(request({ confirmation })); expect(response.status).toBe(200);
    const body = await response.json(); const output = JSON.parse(body.result.content[0].text);
    expect(body.result._meta.trust).toBe("untrusted"); expect(output.static).toBe(true); expect(killed).toHaveBeenCalledOnce();
    expect(created.mock.calls[0]).toEqual([expect.objectContaining({ tenantId: "tenant_mcp", network: { mode: "deny_all", allowedHosts: [] } })]);
    expect(JSON.stringify(created.mock.calls)).not.toContain(token); expect(JSON.stringify(body)).not.toContain("HOST_SECRET");
    const previewRequest = () => new Request(`${config.resource}/preview`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: new URL(config.resource).origin, "x-mcp-preview": output.previewHandle } });
    await db.pool.query("update developer_mcp.projects set client_id='foreign_client'");
    expect((await exchangeDeveloperPreview(runtime(), previewRequest())).status).toBe(403);
    await db.pool.query("update developer_mcp.projects set client_id='client_mcp'");
    const preview = await exchangeDeveloperPreview(runtime(), previewRequest()); expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'"); expect(await preview.text()).toContain("Tenant module");
    expect((await exchangeDeveloperPreview(runtime(), previewRequest())).status).toBe(403);
    expect((await call(request({ confirmation, key: "request_idempotency_reuse" }))).status).toBe(403);
    expect((await store.audit.verifyChain("tenant_mcp")).intact).toBe(true);
  });
});
