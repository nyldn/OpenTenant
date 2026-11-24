import { projectAuthority, validRedirect, resolveEffectiveAuthority, type DeveloperMcpStore } from "@opentenant/developer-mcp";
import { readBoundedBytes } from "../../../../lib/bounded-body";
import { currentSession } from "../../../../lib/session";
import { currentTenant } from "../../../../lib/tenant";
import { identityProviderFromEnv } from "../../../../lib/identity";
import type { TenantId } from "@opentenant/auth";
export async function developerHuman() {
  if (!["local", "better-auth"].includes(identityProviderFromEnv())) return null;
  const tenant = await currentTenant();
  const session = tenant && await currentSession(tenant.tenantId as TenantId);
  return session && session.activeTenantId === tenant?.tenantId ? { tenantId: tenant.tenantId, userId: session.userId } : null;
}
export const browserHeaders = { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "Referrer-Policy": "strict-origin", "X-Content-Type-Options": "nosniff" };
export const escapeHtml = (text: string) => text.replace(/[&<>"']/gu, c => `&#${c.charCodeAt(0)};`);
export const browserPage = (body: string) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Developer access</title><main>${body}</main></html>`, { headers: { ...browserHeaders, "Content-Type": "text/html; charset=utf-8" } });
export const browserDenied = () => new Response("Developer access denied", { status: 403, headers: browserHeaders });
export async function oauthForm(req: Request) {
  if (req.headers.get("content-type")?.split(";", 1)[0] !== "application/x-www-form-urlencoded") throw new Error("Denied");
  const result = await readBoundedBytes(req, 8192); if (!result.ok) throw new Error("Denied");
  return new URLSearchParams(new TextDecoder().decode(result.bytes));
}
export async function browserForm(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) throw new Error("Denied");
  return oauthForm(req);
}

export async function registeredDeveloperConsent(store: DeveloperMcpStore, params: URLSearchParams, human: { tenantId: string; userId: string }) {
  return store.transaction(async client => {
    const authority = await projectAuthority(store, client, params.get("project_id") ?? "", human);
    const redirect = params.get("redirect_uri") ?? "";
    if (!authority || authority.principal.clientId !== params.get("client_id") || !validRedirect(redirect)) return null;
    const registered = await client.query("select client_id from developer_mcp.oauth_clients where client_id=$1 and redirect_uri=$2 for share", [authority.principal.clientId, redirect]);
    return registered.rowCount === 1 ? { authority, redirect, scopes: resolveEffectiveAuthority(authority.source).effectiveSlugs } : null;
  });
}
