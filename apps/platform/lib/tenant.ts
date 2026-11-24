import { traceSpan } from "@opentenant/observability/tracing";
import { serverConfig } from "./server-config";
/**
 * Server-only tenant context for the current request (spec section 7).
 *
 * Resolution order:
 * 1. Verified active domain from the control plane (production path).
 * 2. Development override cookie, honored only on localhost or host suffixes
 *    explicitly configured through PLATFORM_DEV_HOST_SUFFIXES.
 * 3. PLATFORM_DEFAULT_TENANT_ID (development bootstrap).
 *
 * Unknown production hosts resolve to null and callers must render the
 * generic not-found response.
 */
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { normalizeHost } from "@opentenant/domains";
import { PgTenantResolver, type ResolvedTenant } from "@opentenant/database";
import { verifiedCustomTenantForHost } from "./custom-domains-resolution";
import { controlPlanePool } from "./control-plane";

export const TENANT_OVERRIDE_COOKIE = "opentenant_dev_tenant";

let resolver: PgTenantResolver | null = null;

function tenantResolver(): PgTenantResolver {
  if (!resolver) resolver = new PgTenantResolver(controlPlanePool());
  return resolver;
}

function isDevHost(host: string | null, rawHost: string | null): boolean {
  const suffixes = (serverConfig().PLATFORM_DEV_HOST_SUFFIXES ?? "")
    .split(",")
    .map((suffix) => suffix.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  if (host !== null && (
    suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  )) return true;
  if (rawHost === null) return false;
  const bareHost = rawHost.toLowerCase().split(":", 1)[0];
  return bareHost === "localhost" || bareHost === "127.0.0.1";
}

// Request-scoped lookup includes lifecycle state so suspension cannot be hidden
// by PgTenantResolver's process-wide active-host cache.
const verifiedHostTenant = cache(async (host: string): Promise<ResolvedTenant | null> => {
  const { rows } = await controlPlanePool().query<ResolvedTenant>(
    `select t.tenant_id as "tenantId",t.slug,t.display_name as "displayName",t.status
       from domains d join tenants t on t.tenant_id=d.tenant_id
      where d.host=$1 and d.active=true and d.verification='verified'
        and (d.kind='opentenant_subdomain' or d.verification_valid_until > now())`, [host],
  );
  return rows[0] ?? null;
});

/** Only status is exposed; callers never receive a tenant identifier here. */
export const tenantLifecycleForHost = cache(async (): Promise<{ status: string } | null> => {
  const headerStore = await headers();
  const host = normalizeHost(headerStore.get("x-opentenant-host") ?? headerStore.get("host"));
  const tenant = host ? await verifiedHostTenant(host) : null;
  return tenant ? { status: tenant.status } : null;
});

// React supplies the cache dispatcher only during Server Component rendering;
// Route Handlers remain correct when every call executes independently.
export async function tenantForRequestHost(rawHost: string | null, overrideSlug?: string): Promise<ResolvedTenant | null> {
  const host = normalizeHost(rawHost);

  if (host !== null) {
    const config = serverConfig();
    const base = config.OPENTENANT_TENANT_BASE_DOMAIN;
    const byDomain = host !== normalizeHost(config.PLATFORM_ADMIN_HOST) && host !== base && !host.endsWith(`.${base}`)
      ? await verifiedCustomTenantForHost(host, controlPlanePool())
      : await verifiedHostTenant(host);
    if (byDomain) return byDomain.status === "active" ? byDomain : null;
  }

  if (serverConfig().NODE_ENV === "production") return null;

  if (isDevHost(host, rawHost)) {
    if (overrideSlug && /^[a-z0-9-]{1,40}$/.test(overrideSlug)) {
      const bySlug = await tenantResolver().tenantForSlug(overrideSlug);
      if (bySlug) return bySlug;
    }
    const fallback = serverConfig().PLATFORM_DEFAULT_TENANT_ID;
    if (fallback) {
      const { rows } = await controlPlanePool().query<{ slug: string; display_name: string; status: string }>(
        "select slug, display_name, status from tenants where tenant_id = $1 and status = 'active'",
        [fallback],
      );
      const row = rows[0];
      if (row) return { tenantId: fallback, slug: row.slug, displayName: row.display_name, status: row.status };
    }
  }

  return null;
}

const resolveCurrentTenant = cache(async () => {
  const headerStore = await headers();
  const rawHost = headerStore.get("x-opentenant-host") ?? headerStore.get("host");
  const override = serverConfig().NODE_ENV !== "production" && isDevHost(normalizeHost(rawHost), rawHost)
    ? (await cookies()).get(TENANT_OVERRIDE_COOKIE)?.value : undefined;
  return tenantForRequestHost(rawHost, override);
});

export function currentTenant(): Promise<ResolvedTenant | null> {
  return traceSpan("tenant.resolve", () => resolveCurrentTenant());
}

/** Node middleware checks lifecycle before rendering, including suspended tenants. */
export async function knownRequestHost(rawHost: string | null, overrideSlug?: string): Promise<boolean> {
  const host = normalizeHost(rawHost);
  // The configured administration host is a platform surface with no tenant
  // domain row. Its routes enforce platform_admin from the validated session.
  if (host !== null && host === normalizeHost(serverConfig().PLATFORM_ADMIN_HOST)) return true;
  if (host && await verifiedHostTenant(host)) return true;
  return (await tenantForRequestHost(rawHost, overrideSlug)) !== null;
}
