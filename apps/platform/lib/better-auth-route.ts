import { normalizeHost } from "@opentenant/domains";
import { NextRequest, NextResponse } from "next/server";
import { routingConfig } from "./server-config";
import { identityProviderFromEnv } from "./identity-provider";

/** Call only after host validation and reserved-header stripping. The host
 * page still runs normal tenant resolution. No provider API, POST or JSON
 * request is intercepted here.
 */
export function betterAuthBrowserRoute(request: NextRequest, trustedHeaders: Headers): NextResponse | null {
  if (request.nextUrl.pathname !== "/auth/better-auth/login" || request.method !== "GET"
    || request.headers.get("accept")?.includes("application/json")
    || identityProviderFromEnv() !== "better-auth") return null;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  // Next's development refresh runtime evaluates webpack modules. Production
  // never receives this source; all inline scripts still require the nonce.
  const developmentScript = routingConfig().NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const policy = `default-src 'none'; script-src 'self' 'nonce-${nonce}'${developmentScript}; style-src 'self' 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
  const headers = new Headers(trustedHeaders);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "same-origin");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

/** After resolving the tenant, recover the external authority from the host
 * validated by middleware. Next's custom server can use localhost in req.url.
 * Origin and forwarding headers never select the request authority.
 */
export function hostBoundRequest(request: Request): Request {
  const host = request.headers.get("host");
  const trusted = request.headers.get("x-opentenant-host");
  if (!host || !trusted || normalizeHost(host) !== trusted) return request;
  const target = new URL(request.url);
  const authority = new URL(`${target.protocol}//${host}`);
  if (authority.username || authority.password || authority.pathname !== "/" || authority.search || authority.hash || authority.hostname !== trusted) return request;
  target.host = authority.host;
  return new Request(target, request);
}
