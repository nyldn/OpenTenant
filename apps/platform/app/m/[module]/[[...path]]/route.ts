import { serverConfig } from "../../../../lib/server-config";
import { traceSpan } from "@opentenant/observability/tracing";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { signModuleContext } from "@opentenant/security";
import { isValidModuleKey } from "@opentenant/platform-core";
import type { TenantId } from "@opentenant/auth";
import { brandForTenant } from "../../../../lib/brand";
import { currentSession } from "../../../../lib/session";
import { enabledRemoteModule } from "../../../../lib/module-registry";
import {
  moduleAccessPolicy,
  accessCookieName,
  hasValidAccessGrant,
  resolvePermissions,
} from "../../../../lib/module-access";
import { currentTenant } from "../../../../lib/tenant";
import { cookies } from "next/headers";
import { sameOrigin } from "../../../../lib/settings-guard";
import { readBoundedBytes } from "../../../../lib/bounded-body";

export const dynamic = "force-dynamic";

const FORWARDED_REQUEST_HEADERS = ["accept", "accept-language", "content-type", "user-agent"] as const;

/** Remote modules may supply content metadata, never origin-wide browser policy. */
const FORWARDED_RESPONSE_HEADERS = [
  "content-type", "content-language", "etag", "last-modified", "vary",
] as const;

/** Canonicalize relative redirects and keep them inside this module's mount. */
function moduleLocation(location: string, requestUrl: string, moduleKey: string): string | null {
  // Reject absolute/network-path URLs, encoded separators and nested escapes.
  if (/^[a-z][a-z0-9+.-]*:/iu.test(location) || location.startsWith("//") ||
      /[\\\u0000-\u0020]/u.test(location) || /%(?:2f|5c|25)/iu.test(location)) return null;
  try {
    const base = new URL(requestUrl);
    const target = new URL(location, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(`/m/${moduleKey}/`)) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

/** Matches the hosted function request ceiling; modules proxy forms, not uploads. */
const MODULE_REQUEST_MAX_BYTES = 4 * 1024 * 1024;

const MODULE_SANDBOX_POLICY = "sandbox allow-scripts allow-forms allow-popups allow-downloads; frame-ancestors 'self'";

function remoteTarget(baseUrl: string, path: readonly string[], requestUrl: string): URL | null {
  if (path.some((segment) => segment === "." || segment === ".." || /[\\/\u0000]/u.test(segment))) {
    return null;
  }
  const target = new URL(baseUrl);
  const approvedOrigin = target.origin;
  const prefix = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;
  target.pathname = `${prefix}${path.map((segment) => encodeURIComponent(segment)).join("/")}`;
  target.search = new URL(requestUrl).search;
  target.hash = "";
  return target.origin === approvedOrigin ? target : null;
}

/**
 * Remote module composition (ADR-003). Resolves the tenant, enforces the
 * module's access policy, mints a short-lived signed context, and proxies to
 * the module's own deployment. The module trusts only the signed context
 * header; it never sees platform credentials or the control plane.
 */
async function proxy(req: Request, params: { module: string; path?: string[] }): Promise<Response> {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !sameOrigin(req)) {
    return new Response("forbidden", { status: 403 });
  }
  const tenant = await currentTenant();
  if (!tenant) return new Response(null, { status: 404 });

  const moduleKey = params.module;
  if (!isValidModuleKey(moduleKey)) return new Response(null, { status: 404 });

  const remote = await enabledRemoteModule(tenant.tenantId, moduleKey);
  if (!remote) return new Response(null, { status: 404 });
  const target = remoteTarget(remote.remoteUrl, params.path ?? [], req.url);
  if (!target) return new Response(null, { status: 404 });

  // Enforce access exactly as a native module route would (spec 7.9).
  const policy = await moduleAccessPolicy(tenant.tenantId, moduleKey);
  const cookieStore = await cookies();
  let userId: string | null = null;
  const permissions: string[] = [];

  if (policy.mode === "passcode") {
    const grant = cookieStore.get(accessCookieName(moduleKey))?.value;
    if (!hasValidAccessGrant(grant, tenant.tenantId, moduleKey, policy.passcodeHash)) {
      return Response.redirect(new URL(`/access/${moduleKey}`, req.url), 302);
    }
  } else {
    const session = await currentSession(tenant.tenantId as TenantId);
    if (!session || (session.activeTenantId !== tenant.tenantId && !session.isPlatformAdmin)) {
      return Response.redirect(new URL(`/auth/login?return=/m/${moduleKey}`, req.url), 302);
    }
    userId = session.userId;
    permissions.push(...(await resolvePermissions(session, tenant.tenantId, moduleKey)));
  }

  const limited = req.method === "POST" ? await enforceRateLimit(req, { tenantId: tenant.tenantId, userId: userId ?? "anonymous", routeClass: "module-access" }) : null; if (limited) return limited;

  const privateKey = serverConfig().MODULE_SIGNING_PRIVATE_KEY;
  if (!privateKey) return new Response("module signing not configured", { status: 500 });

  const brand = await brandForTenant(tenant.tenantId);
  const context = signModuleContext(
    {
      tenantId: tenant.tenantId,
      moduleKey,
      moduleVersion: remote.version,
      userId,
      permissions,
      brand: { displayName: brand.displayName, logoUrl: brand.logoUrl, cssBrandKey: brand.cssBrandKey },
    },
    privateKey,
  );

  // Proxy to the module deployment. The signed context travels in a header;
  // spoofed inbound copies were stripped by middleware.
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("x-opentenant-module-context", context);

  let body: Uint8Array<ArrayBuffer> | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const read = await readBoundedBytes(req, MODULE_REQUEST_MAX_BYTES);
    if (!read.ok) return new Response(null, { status: read.reason === "too_large" ? 413 : 400 });
    body = read.bytes;
  }
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });

  const respHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) respHeaders.set(name, value);
  }
  const location = upstream.headers.get("location");
  if (location !== null) {
    const safeLocation = moduleLocation(location, req.url, moduleKey);
    if (safeLocation !== null) respHeaders.set("location", safeLocation);
  }
  // Module output is untrusted (ADR-003) yet served on the tenant origin. An
  // opaque sandbox origin keeps its scripts from calling platform APIs with
  // the viewer's cookies or registering an origin-wide service worker.
  respHeaders.set("content-security-policy", MODULE_SANDBOX_POLICY);
  respHeaders.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

/** Access gates and upstream responses must never outlive the current authorization. */
async function handle(req: Request, params: { module: string; path?: string[] }): Promise<Response> {
  const response = await traceSpan("module.proxy", () => proxy(req, params));
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-frame-options", "SAMEORIGIN");
  return new Response(response.body, { status: response.status, headers });
}

export async function GET(req: Request, ctx: { params: Promise<{ module: string; path?: string[] }> }) {
  return handle(req, await ctx.params);
}
export async function POST(req: Request, ctx: { params: Promise<{ module: string; path?: string[] }> }) {
  return handle(req, await ctx.params);
}
