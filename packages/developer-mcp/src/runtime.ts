import { randomBytes } from "node:crypto";
import { PgAdmissionStore } from "@opentenant/database";
import { scaffoldDeveloperModule, type SandboxAdapter } from "@opentenant/sandbox";
import { authorizeDeveloperMcpCall } from "./call-authorization";
import { resolveEffectiveAuthority } from "./authority";
import { buildServerDiscovery } from "./protocol";
import { buildToolList } from "./catalog";
import { protectedResourceMetadata, type DeveloperMcpConfig } from "./config";
import { DeveloperMcpStore, opaqueSecret, scaffoldInputDigest, secretDigest, type RuntimeAuthority } from "./runtime-store";
import { validateRuntimeRequest } from "./runtime-protocol";

/**
 * Client-supplied proof headers. They must stay outside the reserved
 * x-opentenant-* namespace, which the platform middleware strips from every
 * inbound request so trusted tenant context cannot be spoofed.
 */
export const DEVELOPER_MCP_CONFIRMATION_HEADER = "x-mcp-confirmation";
export const DEVELOPER_MCP_PREVIEW_HEADER = "x-mcp-preview";

const MAX_BODY = 8192;
const POLICY = Object.freeze({ maxRequests: 10, windowMs: 60_000, maxConcurrent: 1, leaseMs: 40_000, idempotencyTtlMs: 60_000, maxIdempotencyEntriesPerScope: 50, maxSizeBytes: MAX_BODY });
export interface DeveloperRuntime {
  config: DeveloperMcpConfig;
  store: DeveloperMcpStore;
  sandbox(): SandboxAdapter;
  membershipActive(principal: RuntimeAuthority["principal"]): Promise<boolean>;
  /** Resolve verified host ownership, never a tenant supplied in tool arguments. */
  tenant(): Promise<string | null>;
}
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
function currentJobAuthority(current: RuntimeAuthority | null, original: RuntimeAuthority): boolean {
  if (!current || current.projectId !== original.projectId || current.principal.tenantId !== original.principal.tenantId
    || current.principal.userId !== original.principal.userId || current.principal.clientId !== original.principal.clientId) return false;
  const slugs = resolveEffectiveAuthority(current.source).effectiveSlugs;
  return slugs.includes("module.dev.workspace.create") && slugs.includes("module.dev.preview.open");
}
const denial = (status: number, code: string) => reply(status, { error: { code, message: "Developer MCP request denied" } });
const bearer = (req: Request) => /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
async function readBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > MAX_BODY) throw new Error("Body too large"); parts.push(chunk.value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export function createDeveloperMcpHandler(deps: DeveloperRuntime) {
  return async (req: Request): Promise<Response> => {
    if (!deps.config.enabled) return denial(404, "disabled");
    try {
      if (req.method === "GET" && new URL(req.url).search === "?metadata") return reply(200, protectedResourceMetadata(deps.config));
      if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, { Allow: "POST" });
      const origin = req.headers.get("origin");
      if (origin && origin !== new URL(deps.config.resource).origin) return denial(403, "origin_denied");
      const token = bearer(req), tenantId = await deps.tenant();
      const authority = token && tenantId ? await deps.store.transaction((client) => deps.store.authority(client, token, deps.config.resource, tenantId)) : null;
      if (!authority || !await deps.membershipActive(authority.principal)) {
        await deps.store.transaction((client) => deps.store.event(client, null, "unauthenticated"));
        return reply(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer resource_metadata="${deps.config.resource}?metadata"` });
      }
      const enabled = await deps.store.transaction((client) => deps.store.enabled(client, authority.principal.tenantId));
      if (!enabled) { await deps.store.transaction((client) => deps.store.event(client, authority, "kill_switch")); return denial(403, "disabled"); }
      let body: unknown;
      try { body = await readBody(req); } catch { return denial(400, "invalid_request"); }
      const checked = validateRuntimeRequest(req.headers, body);
      if (!checked.ok) return reply(checked.error.httpStatus, { jsonrpc: "2.0", id: null, error: checked.error });
      const rpc = checked.request;
      if (rpc.method === "server/discover") return reply(200, { jsonrpc: "2.0", id: rpc.id, result: buildServerDiscovery() });
      if (rpc.method === "tools/list") {
        const list = buildToolList(resolveEffectiveAuthority(authority.source).effectiveSlugs);
        const tools = list.tools.filter((tool) => tool.name === "workspace.create").map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, templateId: { type: "string", enum: ["opentenant/module-service@1"] } } } }));
        return reply(200, { jsonrpc: "2.0", id: rpc.id, result: { ...list, tools } });
      }
      if (!("arguments" in rpc.params)) return denial(400, "invalid_request");
      const args = rpc.params.arguments;
      const idempotencyKey = req.headers.get("idempotency-key");
      if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) return denial(400, "idempotency_required");
      const admission = new PgAdmissionStore(deps.store.pool);
      const admitted = await admission.admit({ scope: { tenantId: authority.principal.tenantId, principalId: authority.principal.userId, operation: "developer-mcp" }, idempotencyKey, fingerprint: scaffoldInputDigest(args), sizeBytes: Buffer.byteLength(JSON.stringify(body)) }, POLICY);
      if (!admitted.admitted) { await deps.store.transaction((client) => deps.store.event(client, authority, "admission_denied")); return denial(429, "admission_denied"); }
      if (admitted.replayed) return denial(409, "replay_denied");
      const jobId = randomBytes(16).toString("hex");
      try {
        const allowed = await deps.store.transaction(async (client) => {
          const resolved = await deps.store.authority(client, token!, deps.config.resource, tenantId!);
          const current = resolved && currentJobAuthority(resolved, authority) ? resolved : null;
          if (!current || !await deps.membershipActive(current.principal) || !await deps.store.enabled(client, authority.principal.tenantId)) { await deps.store.event(client, authority, "revoked"); return false; }
          const nowMs = Date.now();
          const decision = await authorizeDeveloperMcpCall({ toolName: "workspace.create", principal: current.principal, authoritySource: current.source,
            resource: { resourceType: "module_project", resourceId: current.projectId }, nowMs,
            auditAppendAdapter: { append: (record) => deps.store.authorizationAudit(client, record) },
            revocationAdapter: { revalidate: async () => ({ status: "active", checkedAtMs: nowMs, source: "live" }) },
            resourceAuthorizationAdapter: { authorize: async () => ({ status: current.projectId === authority.projectId && current.principal.tenantId === tenantId ? "allowed" : "denied" }) },
          });
          if (decision.status !== "allowed") return false;
          const confirmation = req.headers.get(DEVELOPER_MCP_CONFIRMATION_HEADER);
          const consumed = confirmation && await client.query(`update developer_mcp.confirmations set consumed=true where digest=$1 and tenant_id=$2 and user_id=$3 and client_id=$4 and project_id=$5 and input_digest=$6 and tool='workspace.create' and expires_at>clock_timestamp() and not consumed returning digest`,
            [secretDigest(confirmation), current.principal.tenantId, current.principal.userId, current.principal.clientId, current.projectId, scaffoldInputDigest(args)]);
          if (!consumed || consumed.rowCount !== 1) { await deps.store.event(client, authority, "confirmation_required"); return false; }
          // A free local VM still consumes a finite installation-owned execution budget.
          const used = Number((await client.query("select count(*) from developer_mcp.jobs where tenant_id=$1 and created_at>clock_timestamp()-interval '1 hour'", [tenantId])).rows[0]?.count);
          if (used >= 20) { await deps.store.event(client, authority, "budget_exceeded"); return false; }
          await client.query(`insert into developer_mcp.jobs(id,tenant_id,project_id,user_id,client_id,input_digest,lease_id,expires_at,status) values($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),'running')`,
            [jobId, tenantId, current.projectId, current.principal.userId, current.principal.clientId, scaffoldInputDigest(args), admitted.lease.leaseId, Math.min(current.expiresAtMs, admitted.lease.expiresAtMs, Date.now()+60_000)]);
          await deps.store.event(client, authority, "started", jobId);
          return true;
        });
        if (!allowed) return denial(403, "authority_or_confirmation_denied");
        const controller = new AbortController();
        const deadline = Math.min(authority.expiresAtMs, admitted.lease.expiresAtMs, Date.now()+30_000);
        const timeout = setTimeout(() => controller.abort(), Math.max(0, deadline-Date.now()));
        let checking = false;
        let pendingCheck: Promise<void> | undefined;
        const monitor = setInterval(() => {
          if (checking || controller.signal.aborted) return;
          checking = true;
          pendingCheck = deps.store.transaction(async (client) => {
            const resolved = await deps.store.authority(client, token!, deps.config.resource, tenantId!);
          const current = resolved && currentJobAuthority(resolved, authority) ? resolved : null;
            if (!currentJobAuthority(current, authority) || !current || !await deps.membershipActive(current.principal) || !await deps.store.enabled(client, authority.principal.tenantId)) controller.abort();
          }).catch(() => controller.abort()).finally(() => { checking = false; });
        }, 1000);
        let result: Awaited<ReturnType<typeof scaffoldDeveloperModule>>;
        try { result = await scaffoldDeveloperModule(deps.sandbox(), authority.principal.tenantId, jobId, controller.signal); }
        finally { clearTimeout(timeout); clearInterval(monitor); await pendingCheck; }
        if (controller.signal.aborted) throw new Error("Job authority expired");
        const preview = opaqueSecret();
        const completed = await deps.store.transaction(async (client) => {
          const resolved = await deps.store.authority(client, token!, deps.config.resource, tenantId!);
          const current = resolved && currentJobAuthority(resolved, authority) ? resolved : null;
          const job = (await client.query("select id from developer_mcp.jobs where id=$1 and status='running' and expires_at>clock_timestamp() for update", [jobId])).rows[0];
          if (!current || !job || !await deps.membershipActive(current.principal) || !await deps.store.enabled(client, authority.principal.tenantId)) { await client.query("update developer_mcp.jobs set status='failed' where id=$1", [jobId]); await deps.store.event(client, authority, "revoked", jobId); return false; }
          await client.query("update developer_mcp.jobs set status='complete' where id=$1", [jobId]);
          await client.query(`insert into developer_mcp.previews(digest,job_id,tenant_id,user_id,client_id,html,expires_at) values($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0))`, [secretDigest(preview), jobId, tenantId, authority.principal.userId, authority.principal.clientId, result.html, Math.min(current.expiresAtMs, Date.now()+60_000)]);
          await deps.store.event(client, authority, "completed", jobId); return true;
        });
        if (!completed) return denial(403, "revoked");
        const output = JSON.stringify({ workspaceId: jobId, previewHandle: preview, previewPath: "/api/mcp/developer/preview", previewDigest: result.digest, static: true });
        return reply(200, { jsonrpc: "2.0", id: rpc.id, result: { resultType: "complete", content: [{ type: "text", text: output }], _meta: { trust: "untrusted", contentType: "application/json", byteCount: Buffer.byteLength(output), digest: secretDigest(output), truncated: false } } });
      } catch {
        await deps.store.transaction(async (client) => { await client.query("update developer_mcp.jobs set status='failed' where id=$1", [jobId]); await deps.store.event(client, authority, "failed", jobId); });
        return denial(503, "execution_unavailable");
      } finally { await admission.release({ scope: admitted.lease.scope, leaseId: admitted.lease.leaseId }); }
    } catch { return denial(503, "unavailable"); }
  };
}

/** POST consumes the handle, after identity + tenant + client + live switch checks. */
export async function exchangeDeveloperPreview(deps: DeveloperRuntime, req: Request): Promise<Response> {
  if (!deps.config.enabled) return denial(404, "disabled");
  if (req.method !== "POST" || req.headers.get("origin") !== new URL(deps.config.resource).origin) return denial(403, "preview_denied");
  try {
    const token = bearer(req), tenant = await deps.tenant();
    if (!token || !tenant) return denial(401, "unauthorized");
    const handle = req.headers.get(DEVELOPER_MCP_PREVIEW_HEADER);
    if (!handle || handle.length > 128) return denial(403, "preview_denied");
    const html = await deps.store.transaction(async (client) => {
      const current = await deps.store.authority(client, token, deps.config.resource, tenant);
      if (!current || !await deps.membershipActive(current.principal) || !resolveEffectiveAuthority(current.source).effectiveSlugs.includes("module.dev.preview.open") || !await deps.store.enabled(client, tenant)) return null;
      const result = await client.query<{ html: string }>(`update developer_mcp.previews p set consumed=true from developer_mcp.jobs j where p.digest=$1 and p.job_id=j.id and j.status='complete' and p.tenant_id=$2 and p.user_id=$3 and p.client_id=$4 and j.project_id=$5 and p.expires_at>clock_timestamp() and not p.consumed returning p.html`, [secretDigest(handle), tenant, current.principal.userId, current.principal.clientId, current.projectId]);
      if (!result.rows[0]) return null;
      await deps.store.event(client, current, "preview_consumed"); return result.rows[0].html;
    });
    if (!html) return denial(403, "preview_denied");
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" } });
  } catch { return denial(503, "unavailable"); }
}
