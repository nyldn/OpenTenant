import { betterAuthBrowserRoute } from "./lib/better-auth-route";
import { knownRequestHost, TENANT_OVERRIDE_COOKIE } from "./lib/tenant";
import { routingConfig } from "./lib/server-config";
import { NextRequest, NextResponse } from "next/server";
import { normalizeHost } from "@opentenant/domains";
import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextMiddleware } from "next/server";
import { customDomainIdentityPath } from "./lib/custom-domains-routing";
import { usesClerkIdentity } from "./lib/identity-provider";

/**
 * Host resolution entry point (architecture spec section 7).
 *
 * Order of operations per spec: normalize the host and fail closed on
 * malformed input, resolve the platform administration domain before tenant
 * domains, then hand the normalized host to downstream tenant resolution.
 * The Node runtime resolves verified domains before authentication or React.
 * Unknown hosts receive a complete generic document without rendering a layout.
 */
function securedHeaders(request: NextRequest): Headers | NextResponse {
  const host = normalizeHost(request.headers.get("host"));

  // Local development convenience: localhost has no tenant semantics.
  const isDevHost = routingConfig().NODE_ENV !== "production" && request.nextUrl.hostname === "localhost";

  if (host === null && !isDevHost) {
    // Malformed or missing host: generic response, no tenant details.
    return unknownHostResponse();
  }

  // Strip the entire reserved x-opentenant-* namespace, which carries trusted
  // tenant context downstream, so nothing upstream can pre-set any of it.
  const headers = new Headers(request.headers);
  for (const name of Array.from(headers.keys())) {
    if (name.toLowerCase().startsWith("x-opentenant-")) {
      headers.delete(name);
    }
  }

  if (host !== null) {
    const platformAdminHost = routingConfig().PLATFORM_ADMIN_HOST ?? null;
    headers.set("x-opentenant-host", host);
    if (platformAdminHost !== null && host === normalizeHost(platformAdminHost)) {
      // Platform administration domain resolves before any tenant domain.
      // This header is a routing hint only: the Host header is
      // client-controllable, so platform-admin routes must always enforce
      // the platform_admin role from the validated session and never treat
      // x-opentenant-surface as an authorization input.
      headers.set("x-opentenant-surface", "platform-admin");
    }
  }

  return headers;
}

export function hostSecurityMiddleware(request: NextRequest): NextResponse {
  const result = securedHeaders(request);
  return result instanceof NextResponse
    ? result
    : NextResponse.next({ request: { headers: result } });
}

const PROBE_PATHS = new Set(["/api/health", "/api/ready"]);

let clerkHandler: NextMiddleware | null = null;

export async function middleware(request: NextRequest, event?: NextFetchEvent) {
  const security = securedHeaders(request);
  if (security instanceof NextResponse) return security;
  // Infrastructure probes use arbitrary Host headers and return no tenant data.
  if (PROBE_PATHS.has(request.nextUrl.pathname)) return NextResponse.next({ request: { headers: security } });
  // Next 15.5 runs this boundary in Node, before any layout or auth adapter.
  try {
    if (!await knownRequestHost(request.headers.get("host"), request.cookies.get(TENANT_OVERRIDE_COOKIE)?.value)) {
      return unknownHostResponse();
    }
  } catch {
    // Resolution failure is closed and never exposes a driver error or tenant.
    return unknownHostResponse();
  }
  const host = security.get("x-opentenant-host");
  const configuredBase = routingConfig().OPENTENANT_TENANT_BASE_DOMAIN;
  const base = configuredBase === "localhost" ? "localhost" : normalizeHost(configuredBase) ?? "example.test";
  const adminHost = normalizeHost(routingConfig().PLATFORM_ADMIN_HOST);
  if (host && host !== adminHost && host !== base && !host.endsWith(`.${base}`)
    && !host.endsWith(".localhost") && customDomainIdentityPath(request.nextUrl.pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/api/settings/domains/auth";
    target.search = "";
    target.searchParams.set("path", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.rewrite(target, { request: { headers: security } });
  }
  if (!usesClerkIdentity()) return betterAuthBrowserRoute(request, security) ?? NextResponse.next({ request: { headers: security } });
  if (!clerkHandler) {
    clerkHandler = clerkMiddleware((_auth, clerkRequest) => hostSecurityMiddleware(clerkRequest));
  }
  const sanitizedRequest = new NextRequest(request, { headers: security });
  return clerkHandler(sanitizedRequest, event as NextFetchEvent);
}

export const config = {
  runtime: "nodejs",
  matcher: [
    // Public readiness assets must work before database provisioning. They do
    // not render a layout or expose tenant data.
    "/((?!_next/static|_next/image|favicon.ico|opentenant-logo[.]svg$).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};

function unknownHostResponse() {
  return new NextResponse('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title></head><body><main><h1>Not found</h1><p>The requested page could not be found.</p></main></body></html>', {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" },
  });
}
