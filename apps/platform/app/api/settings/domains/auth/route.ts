import { safeReturnPath } from "@opentenant/auth";
import { normalizeHost } from "@opentenant/domains";
import { controlPlanePool } from "../../../../../lib/control-plane";
import { verifiedCustomTenantForHost, hasVerifiedPlatformDomain } from "../../../../../lib/custom-domains-resolution";
import { platformIdentityDestination } from "../../../../../lib/custom-domains-routing";
import { tenantHostname } from "../../../../../lib/server-config";

export const runtime = "nodejs";

/** Middleware rewrites custom-domain identity requests here before any OAuth handling. */
export async function GET(req: Request): Promise<Response> {
  const host = normalizeHost(req.headers.get("host"));
  if (!host) return new Response("not found", { status: 404 });
  const pool = controlPlanePool();
  const tenant = await verifiedCustomTenantForHost(host, pool);
  if (!tenant) return new Response("not found", { status: 404 });
  const canonical = tenantHostname(tenant.slug);
  if (!await hasVerifiedPlatformDomain(canonical, tenant.tenantId, pool)) return new Response("not found", { status: 404 });
  // Next can retain the original request URL after the middleware rewrite.
  const url = new URL(req.url);
  const originalPath = url.pathname === "/api/settings/domains/auth" ? "/auth/login" : url.pathname + url.search;
  const destination = new URL(platformIdentityDestination(canonical, url.searchParams.get("path") ?? originalPath));
  if (destination.pathname === "/auth/login" || destination.pathname.startsWith("/sign-in")) {
    const key = destination.pathname === "/auth/login" ? "return" : "redirect_url";
    const rawReturn = destination.searchParams.get(key);
    destination.search = "";
    if (rawReturn) destination.searchParams.set(key, safeReturnPath(rawReturn));
  }
  return new Response(null, { status: 302, headers: {
    Location: destination.toString(),
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
}

// Never forward a mutation or its body to a different origin.
export function POST(): Response { return new Response("Use the platform subdomain for settings.", { status: 403 }); }
