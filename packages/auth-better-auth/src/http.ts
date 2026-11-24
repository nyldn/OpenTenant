import { safeReturnPath, type TenantId, type TenantOrgResolver } from "@opentenant/auth";
import type { Pool } from "pg";
import type { BetterAuthConfig } from "./config";
import { AUTH_PATH } from "./constants";
import { createBetterAuth } from "./lazy";
import type { BetterAuthHooks, BetterAuthRuntime } from "./runtime";

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
};
function failure(status = 400): Response {
  return Response.json({ error: "Identity request failed" }, { status, headers: securityHeaders });
}
function loginPage(request: Request, fields?: FormData, error?: string): Response {
  const source = new URL(request.url);
  const target = new URL("/auth/better-auth/login", source);
  target.searchParams.set("return", safeReturnPath(source.searchParams.get("return")));
  target.searchParams.set("invitation", String(fields?.get("invitation") || source.searchParams.get("invitation") || "").slice(0, 200));
  for (const key of ["email", "name", "action"]) {
    const value = fields?.get(key);
    if (typeof value === "string") target.searchParams.set(key, value.slice(0, 254));
  }
  if (error) target.searchParams.set("error", error);
  return new Response(null, { status: 303, headers: { ...securityHeaders, location: target.href } });
}
function loginError(request: Request, form: FormData, code: string, status = 400): Response {
  if (request.headers.get("accept")?.includes("application/vnd.opentenant.auth-form+json")) {
    return Response.json({ error: code }, { status, headers: securityHeaders });
  }
  return request.headers.get("accept")?.includes("text/html") ? loginPage(request, form, code) : failure(status);
}
function requestFailure(request: Request, status = 400): Response {
  return [`${AUTH_PATH}/login`, `${AUTH_PATH}/sign-out`].includes(new URL(request.url).pathname) && request.headers.get("accept")?.includes("text/html")
    ? loginPage(request, undefined, "unavailable") : failure(status);
}

interface RequestContext {
  moduleAccessCookieNames?: readonly string[];
  pool: Pool;
  config: BetterAuthConfig;
  orgs: TenantOrgResolver;
  tenantId: TenantId | null;
  hooks?: BetterAuthHooks;
}

async function bindTenant(auth: BetterAuthRuntime, context: RequestContext, credential: string, invitationId: string): Promise<Headers> {
  const headers = new Headers();
  if (!context.tenantId || !credential) return headers;
  const organizationId = await context.orgs.externalOrganizationForTenant(context.tenantId);
  if (!organizationId) throw new Error("Identity organization required");
  const cookieHeaders = new Headers({ cookie: credential });
  if (invitationId) {
    const target = await context.pool.query('select id, status from ba_invitation where id = $1 and "organizationId" = $2', [invitationId, organizationId]);
    if (target.rows.length !== 1) throw new Error("Identity invitation denied");
    if (target.rows[0].status !== "accepted") await auth.api.acceptInvitation({ body: { invitationId }, headers: cookieHeaders });
  }
  const active = await auth.api.setActiveOrganization({ body: { organizationId }, headers: cookieHeaders, asResponse: true });
  if (!active.ok) {
    await auth.api.signOut({ headers: cookieHeaders });
    throw new Error("Identity membership required");
  }
  for (const cookie of active.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return headers;
}

/** Bound browser credentials before invoking the provider or multipart parser. */
async function loginForm(request: Request): Promise<FormData> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Form required");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); throw new Error("Form too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks.map(chunk => new Uint8Array(chunk))), { headers: { "content-type": request.headers.get("content-type") ?? "application/x-www-form-urlencoded" } }).formData();
}

async function login(request: Request, auth: BetterAuthRuntime, context: RequestContext): Promise<Response> {
  const url = new URL(request.url);
  const form = await loginForm(request);
  const signup = form.get("action") === "signup";
  const body = { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? ""), ...(signup ? { name: String(form.get("name") ?? "") } : {}) };
  // The HTTP handler applies Better Auth's database-backed rate limiter.
  let response: Response;
  try {
    response = await auth.handler(new Request(`${url.origin}${AUTH_PATH}/${signup ? "sign-up" : "sign-in"}/email`, {
    method: "POST", headers: { ...Object.fromEntries(request.headers), "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  } catch {
    return loginError(request, form, "unavailable", 503);
  }
  if (response.status === 429) return loginError(request, form, "rate_limit");
  if (!response.ok) return loginError(request, form, signup ? "signup" : "credentials");
  const sessionCookies = response.headers.getSetCookie();
  const credential = sessionCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
  if (!credential) return loginError(request, form, "verification");
  let headers: Headers;
  try {
    headers = await bindTenant(auth, context, credential, String(form.get("invitation") || url.searchParams.get("invitation") || ""));
  } catch {
    // Account creation can succeed before membership binding. Preserve its
    // cookie so verified-email/existing-account retries need no new account.
    const failed = loginError(request, form, "invitation");
    for (const cookie of sessionCookies) failed.headers.append("set-cookie", cookie);
    return failed;
  }
  for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
  for (const cookie of sessionCookies) headers.append("set-cookie", cookie);
  const destination = safeReturnPath(url.searchParams.get("return"));
  if (request.headers.get("accept")?.includes("application/vnd.opentenant.auth-form+json")) {
    return Response.json({ redirect: destination }, { headers });
  }
  headers.set("location", destination);
  return new Response(null, { status: 303, headers });
}

function providerFailure(request: Request, path: string, providerStatus: number): Response {
  if (path === "/sign-out" && request.headers.get("accept")?.includes("text/html")) return loginPage(request, undefined, "unavailable");
  const status = providerStatus >= 500 ? 503 : providerStatus;
  if (path.startsWith("/scim/v2")) {
    return Response.json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "Identity request failed", status: String(status) }, { status, headers: { ...securityHeaders, "content-type": "application/scim+json" } });
  }
  return failure(status);
}
async function forward(request: Request, auth: BetterAuthRuntime, path: string, moduleAccessCookieNames: readonly string[]): Promise<Response> {
  const forwarded = path === "/sign-out"
    ? new Request(request.url, { method: "POST", headers: { cookie: request.headers.get("cookie") ?? "", origin: new URL(request.url).origin, "content-type": "application/json" }, body: "{}" })
    : request;
  const result = await auth.handler(forwarded);
  if (result.status >= 400) return providerFailure(request, path, result.status);
  const headers = new Headers(result.headers);
  for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
  if (path === "/sign-out") {
    headers.set("location", "/");
    for (const name of moduleAccessCookieNames) {
      if (!/^[A-Za-z0-9_-]+$/u.test(name)) throw new Error("Invalid module cookie name");
      headers.append("set-cookie", `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    }
    return new Response(null, { status: 303, headers });
  }
  return new Response(result.body, { status: result.status, headers });
}

/** Caller must resolve the request host through OpenTenant before passing a tenant. */
export async function handleBetterAuthRequest(request: Request, context: RequestContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    if ((context.config.production && url.protocol !== "https:")
      || (context.tenantId === null && url.origin !== context.config.baseURL)) return failure(404);
    // Each verified tenant host has its own origin and host-only cookies.
    const auth = createBetterAuth(context.pool, { ...context.config, baseURL: url.origin }, context.hooks);
    const path = url.pathname.slice(AUTH_PATH.length);
    if (request.method === "GET" && path === "/login") return loginPage(request);
    const directoryRequest = !!context.config.directory && path.startsWith("/scim/v2");
    const ssoCallback = !!context.config.ssoEnabled && (path.startsWith("/sso/callback/") || path.startsWith("/sso/saml2/"));
    if (directoryRequest && context.tenantId !== null && await context.orgs.tenantForExternalOrganization(context.config.directory!.organizationId) !== context.tenantId) return failure(404);
    if (request.method === "POST" && !directoryRequest && !ssoCallback && request.headers.get("origin") !== url.origin) {
      return requestFailure(request, 403);
    }
    if (request.method === "POST" && path === "/login") return await login(request, auth, context);
    // Public provider administration stays behind the platform's audited gateway.
    const allowed = directoryRequest || ssoCallback
      || (!!context.config.ssoEnabled && path === "/sign-in/sso" && request.method === "POST")
      || (request.method === "GET" && path === "/verify-email")
      || (request.method === "POST" && path === "/sign-out");
    return allowed ? await forward(request, auth, path, context.moduleAccessCookieNames ?? []) : failure(404);
  } catch {
    return requestFailure(request);
  }
}
