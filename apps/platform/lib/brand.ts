/**
 * Server-only brand loading: tenant -> brand_policies -> resolved snapshot
 * (spec section 10.1). The same snapshot drives shell chrome, modules, and
 * later PDF and export surfaces.
 */
import {
  PLATFORM_BRAND_DEFAULTS,
  resolveBrandSnapshot,
  type BrandSnapshot,
  type TenantBrandPolicy,
  type TenantId,
} from "@opentenant/platform-core";
import { controlPlanePool } from "./control-plane";

export async function brandForTenant(tenantId: string): Promise<BrandSnapshot> {
  const { rows } = await controlPlanePool().query<{
    defaults: Record<string, unknown>;
    locked_keys: string[];
    overrides: Record<string, unknown>;
    version: number;
  }>(
    "select defaults, locked_keys, overrides, version from brand_policies where tenant_id = $1",
    [tenantId],
  );

  const row = rows[0];
  const policy: TenantBrandPolicy = {
    tenantId: tenantId as TenantId,
    defaults: asRecord(row?.defaults) as TenantBrandPolicy["defaults"],
    lockedKeys: (Array.isArray(row?.locked_keys) ? row.locked_keys.filter((k) => typeof k === "string") : []) as TenantBrandPolicy["lockedKeys"],
    overrides: asRecord(row?.overrides) as TenantBrandPolicy["overrides"],
    version: typeof row?.version === "number" ? row.version : 0,
  };

  const snapshot = resolveBrandSnapshot(policy, new Date()).snapshot;
  // Brand assets must be same-origin paths; anything else (or malformed
  // stored data) falls back rather than fetching from arbitrary origins.
  return {
    ...snapshot,
    logoUrl: safeAssetPath(snapshot.logoUrl),
    markUrl: safeAssetPath(snapshot.markUrl),
    faviconUrl: safeAssetPath(snapshot.faviconUrl),
    cssBrandKey: /^[a-z0-9-]{1,32}$/.test(snapshot.cssBrandKey) ? snapshot.cssBrandKey : "example",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeAssetPath(value: string | null): string | null {
  if (value === null) return null;
  return /^\/[a-zA-Z0-9._/-]+$/.test(value) ? value : null;
}

export { PLATFORM_BRAND_DEFAULTS };
