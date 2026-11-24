import { routingConfig, serverConfig } from "../../../lib/server-config";
import { normalizeHost } from "@opentenant/domains";
import { TENANT_OVERRIDE_COOKIE } from "../../../lib/tenant";

export const runtime = "nodejs";

/**
 * Development-only tenant selector for hosts that cannot carry per-tenant
 * subdomains (configured preview hosts or localhost). Production domains resolve
 * tenants from the control plane and never read the override cookie.
 */
export async function GET(req: Request): Promise<Response> {
  if (routingConfig().NODE_ENV === "production") return new Response(null, { status: 404 });
  const url = new URL(req.url);
  const host = normalizeHost(req.headers.get("host"));
  const suffixes = (serverConfig().PLATFORM_DEV_HOST_SUFFIXES ?? "")
    .split(",")
    .map((suffix) => suffix.trim().toLowerCase().replace(/^\.+/u, ""))
    .filter(Boolean);
  const isDevHost = host !== null &&
    (host.endsWith(".localhost") || suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)));
  // localhost without a dot never normalizes; treat raw localhost as dev too.
  const rawHost = req.headers.get("host") ?? "";
  const isLocal = /^localhost(?::[0-9]+)?$/iu.test(rawHost);

  if (!isDevHost && !isLocal) return new Response(null, { status: 404 });

  const slug = url.searchParams.get("slug") ?? "";
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return new Response("invalid slug", { status: 400 });

  const headers = new Headers();
  headers.set("Location", "/");
  headers.append(
    "Set-Cookie",
    `${TENANT_OVERRIDE_COOKIE}=${slug}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
  );
  return new Response(null, { status: 302, headers });
}
