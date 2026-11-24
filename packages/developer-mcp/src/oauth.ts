import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { DeveloperMcpStore, opaqueSecret, secretDigest, type RuntimeAuthority } from "./runtime-store";
import type { DeveloperMcpConfig } from "./config";
export function authorizationMetadata(config: DeveloperMcpConfig) {
  const issuer = config.authorizationServer.replace(/\/$/u, "");
  return { issuer: config.authorizationServer, authorization_endpoint: `${issuer}/api/mcp/developer/authorize`, token_endpoint: `${issuer}/api/mcp/developer/token`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] };
}
export async function projectAuthority(store: DeveloperMcpStore, client: PoolClient, projectId: string, human: { tenantId: string; userId: string }): Promise<RuntimeAuthority | null> {
  const row = (await client.query(`select p.* from developer_mcp.projects p join tenants t on t.tenant_id=p.tenant_id where p.id=$1 and p.tenant_id=$2 and p.user_id=$3 and p.active and t.status='active' for share of p,t`, [projectId, human.tenantId, human.userId])).rows[0];
  if (!row || !await store.enabled(client, human.tenantId)) return null;
  return { principal: { tenantId: row.tenant_id, userId: row.user_id, clientId: row.client_id }, projectId: row.id, expiresAtMs: Date.now()+300_000, source: { assignedProfile: row.profile, tokenScopes: row.consent_scopes, consentedClientScopes: row.consent_scopes, resolvedAtMs: Date.now() } };
}
export function validRedirect(value: string): boolean {
  try { const url = new URL(value); return !url.username && !url.password && !url.hash && (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)); } catch { return false; }
}
/** Registered redirects, exact resource, browser session and explicit consent. */
export async function authorizeCode(store: DeveloperMcpStore, config: DeveloperMcpConfig, params: URLSearchParams, human: { tenantId: string; userId: string }): Promise<string> {
  const redirect = params.get("redirect_uri") ?? "", challenge = params.get("code_challenge") ?? "";
  if (params.get("response_type") !== "code" || params.get("resource") !== config.resource || params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/u.test(challenge) || !validRedirect(redirect) || (params.get("state")?.length ?? 0) > 512) throw new Error("OAuth denied");
  return store.transaction(async client => {
    const authority = await projectAuthority(store, client, params.get("project_id") ?? "", human);
    if (!authority || authority.principal.clientId !== params.get("client_id")) throw new Error("OAuth denied");
    const registered = await client.query("select client_id from developer_mcp.oauth_clients where client_id=$1 and redirect_uri=$2 for share", [authority.principal.clientId, redirect]);
    if (registered.rowCount !== 1) throw new Error("OAuth denied");
    const code = opaqueSecret();
    await client.query("insert into developer_mcp.oauth_codes(digest,project_id,client_id,redirect_uri,resource,challenge,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '60 seconds')", [secretDigest(code), authority.projectId, authority.principal.clientId, redirect, config.resource, challenge]);
    await store.event(client, authority, "oauth_consent");
    const target = new URL(redirect); target.searchParams.set("code", code); const state = params.get("state"); if (state) target.searchParams.set("state", state); return target.href;
  });
}
/** Consume code and mint the existing audience-bound opaque access token atomically. */
export async function exchangeCode(store: DeveloperMcpStore, config: DeveloperMcpConfig, form: URLSearchParams, membershipActive: (principal: RuntimeAuthority["principal"]) => Promise<boolean>) {
  const verifier = form.get("code_verifier") ?? "";
  if (form.get("grant_type") !== "authorization_code" || form.get("resource") !== config.resource || !/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier)) throw new Error("OAuth denied");
  return store.transaction(async client => {
    const row = (await client.query("select * from developer_mcp.oauth_codes where digest=$1 and client_id=$2 and redirect_uri=$3 and resource=$4 and expires_at>clock_timestamp() and not consumed for update", [secretDigest(form.get("code") ?? ""), form.get("client_id"), form.get("redirect_uri"), config.resource])).rows[0];
    if (!row || createHash("sha256").update(verifier).digest("base64url") !== row.challenge) throw new Error("OAuth denied");
    const project = (await client.query("select tenant_id,user_id from developer_mcp.projects where id=$1", [row.project_id])).rows[0];
    const authority = project && await projectAuthority(store, client, row.project_id, { tenantId: project.tenant_id, userId: project.user_id });
    if (!authority || !await membershipActive(authority.principal)) throw new Error("OAuth denied");
    await client.query("update developer_mcp.oauth_codes set consumed=true where digest=$1", [row.digest]);
    const token = opaqueSecret();
    await client.query("insert into developer_mcp.tokens(digest,project_id,audience,scopes,expires_at) values($1,$2,$3,$4,now()+interval '5 minutes')", [secretDigest(token), row.project_id, config.resource, authority.source.consentedClientScopes]);
    await store.event(client, authority, "oauth_token");
    return { access_token: token, token_type: "Bearer", expires_in: 300, scope: authority.source.consentedClientScopes?.join(" ") };
  });
}
