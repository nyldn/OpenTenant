import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PgAuditStore } from "@opentenant/database";
import { computeDeveloperMcpAuditDigest, type CommittedDeveloperMcpAuditRecord, type UncommittedDeveloperMcpAuditRecord } from "./audit";
import type { DeveloperMcpAuthoritySource, DeveloperMcpPrincipal } from "./call-authorization";

export const secretDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export const opaqueSecret = () => randomBytes(32).toString("base64url");
export const scaffoldInputDigest = (args: { templateId: string; label: string }) => secretDigest(JSON.stringify([args.templateId, args.label]));
export interface RuntimeAuthority {
  principal: DeveloperMcpPrincipal;
  projectId: string;
  expiresAtMs: number;
  source: DeveloperMcpAuthoritySource;
}
export class DeveloperMcpStore {
  readonly audit: PgAuditStore;
  constructor(readonly pool: Pool) { this.audit = new PgAuditStore(pool); }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("begin"); const result = await fn(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
  async enabled(client: PoolClient, tenantId: string): Promise<boolean> {
    const { rows } = await client.query<{ scope: string; enabled: boolean }>("select scope,enabled from developer_mcp.switches where scope=any($1::text[]) for share", [["installation", `tenant:${tenantId}`]]);
    return rows.length === 2 && rows.every((row) => row.enabled === true);
  }
  async authority(client: PoolClient, token: string, audience: string, tenantId: string): Promise<RuntimeAuthority | null> {
    const { rows } = await client.query<{
      tenant_id: string; user_id: string; client_id: string; id: string; profile: string; scopes: string[]; consent_scopes: string[]; expires_at: Date;
    }>(`select p.*,t.scopes,t.expires_at from developer_mcp.tokens t join developer_mcp.projects p on p.id=t.project_id
         join tenants n on n.tenant_id=p.tenant_id
        where t.digest=$1 and t.audience=$2 and t.expires_at>clock_timestamp() and not t.revoked
          and p.tenant_id=$3 and p.active and n.status='active' for share of t,p,n`, [secretDigest(token), audience, tenantId]);
    const row = rows[0];
    return row ? { principal: { tenantId: row.tenant_id, userId: row.user_id, clientId: row.client_id }, projectId: row.id, expiresAtMs: row.expires_at.getTime(),
      source: { assignedProfile: row.profile, tokenScopes: row.scopes, consentedClientScopes: row.consent_scopes, resolvedAtMs: Date.now() } } : null;
  }
  async event(client: PoolClient, authority: RuntimeAuthority | null, outcome: string, jobId: string | null = null): Promise<void> {
    await this.audit.appendWithClient(client, { tenantId: authority?.principal.tenantId ?? null, occurredAt: new Date(),
      actor: authority ? { kind: "user", userId: authority.principal.userId } : { kind: "system", job: "developer-mcp" },
      action: "developer_mcp.call", subject: jobId ?? "developer-mcp", detail: { outcome, clientId: authority?.principal.clientId ?? null } });
  }
  async authorizationAudit(client: PoolClient, record: UncommittedDeveloperMcpAuditRecord): Promise<CommittedDeveloperMcpAuditRecord> {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [record.tenantId ?? "__platform__"]);
    const last = (await client.query<{ detail: { currentDigest?: string } }>(
      "select detail from audit_events where tenant_id is not distinct from $1 and action='developer_mcp.authorization' order by sequence desc limit 1", [record.tenantId],
    )).rows[0];
    const priorDigest = last?.detail.currentDigest ?? "genesis";
    const currentDigest = computeDeveloperMcpAuditDigest({ ...record, priorDigest });
    const committed = { ...record, priorDigest, currentDigest } as CommittedDeveloperMcpAuditRecord;
    await this.audit.appendWithClient(client, { tenantId: record.tenantId, occurredAt: new Date(),
      actor: record.userId ? { kind: "user", userId: record.userId } : { kind: "system", job: "developer-mcp" },
      action: "developer_mcp.authorization", subject: record.resourceId ?? "unresolved", detail: committed });
    return committed;
  }
  /** Called by a trusted human-review controller, never by an MCP argument or tool output. */
  async confirm(authority: RuntimeAuthority, args: { templateId: string; label: string }, human: { userId: string; tenantId: string }): Promise<string> {
    if (human.userId !== authority.principal.userId || human.tenantId !== authority.principal.tenantId) throw new Error("Confirmation denied");
    const secret = opaqueSecret();
    await this.transaction(async (client) => {
      if (!await this.enabled(client, human.tenantId) || authority.expiresAtMs <= Date.now()) throw new Error("Confirmation denied");
      await client.query(`insert into developer_mcp.confirmations (digest,tenant_id,user_id,client_id,project_id,input_digest,tool,expires_at)
        values ($1,$2,$3,$4,$5,$6,'workspace.create',to_timestamp($7/1000.0))`,
      [secretDigest(secret), human.tenantId, human.userId, authority.principal.clientId, authority.projectId, scaffoldInputDigest(args), Math.min(Date.now() + 60_000, authority.expiresAtMs)]);
      await this.event(client, authority, "confirmation_issued");
    });
    return secret;
  }
  /** Independent owner kill switch. State changes and evidence commit together. */
  async setSwitch(scope: string, enabled: boolean, owner: { kind: "installation_owner"; userId: string }, reason: string): Promise<void> {
    if (!/^(installation|tenant:[a-zA-Z0-9_-]{1,128})$/.test(scope) || !reason.trim() || reason.length > 200) throw new Error("Invalid switch change");
    await this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", ["developer-mcp-switch"]);
      const old = (await client.query<{ enabled: boolean }>("select enabled from developer_mcp.switches where scope=$1 for update", [scope])).rows[0]?.enabled ?? false;
      await client.query("insert into developer_mcp.switches(scope,enabled) values($1,$2) on conflict(scope) do update set enabled=excluded.enabled", [scope, enabled]);
      await this.audit.appendWithClient(client, { tenantId: null, occurredAt: new Date(), actor: owner, action: "developer_mcp.switch", subject: scope, detail: { old, enabled, reason } });
    });
  }
}
