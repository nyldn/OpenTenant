/**
 * Brand precedence resolution (spec 10.1):
 * platform defaults -> tenant defaults -> tenant overrides (unlocked only).
 * Module presentation mappings apply downstream from the snapshot.
 */
import {
  BRAND_POLICY_LOCK_REASON,
  type BrandSnapshot,
  type BrandTokenKey,
  type BrandTokens,
  type TenantBrandPolicy,
} from "./branding";

/** Safe platform-level defaults; every token always resolves to something renderable. */
export const PLATFORM_BRAND_DEFAULTS: BrandTokens = {
  displayName: "OpenTenant",
  logoUrl: "/opentenant-logo.svg",
  markUrl: "/opentenant-mark.svg",
  faviconUrl: null,
  cssBrandKey: "opentenant",
  colorPrimary: "#ea580c",
  colorBackground: "#ffffff",
  colorForeground: "#111111",
  fontFamilyBody: "system-ui, sans-serif",
  fontFamilyHeading: "system-ui, sans-serif",
  supportEmail: null,
  legalLinks: [],
  reportLabel: null,
  exportFilenameSuffix: null,
  coBrandingRequired: false,
};

export interface BrandResolution {
  snapshot: BrandSnapshot;
  /** Overrides ignored because platform policy locks their keys. */
  rejectedOverrideKeys: Array<{
    key: BrandTokenKey;
    reason: typeof BRAND_POLICY_LOCK_REASON;
  }>;
}

export function resolveBrandSnapshot(policy: TenantBrandPolicy, now: Date): BrandResolution {
  const locked = new Set<BrandTokenKey>(policy.lockedKeys);
  const rejectedOverrideKeys: BrandResolution["rejectedOverrideKeys"] = [];

  const tokens: BrandTokens = { ...PLATFORM_BRAND_DEFAULTS, ...policy.defaults };

  for (const [key, value] of Object.entries(policy.overrides) as Array<
    [BrandTokenKey, BrandTokens[BrandTokenKey]]
  >) {
    if (value === undefined) continue;
    if (locked.has(key)) {
      rejectedOverrideKeys.push({ key, reason: BRAND_POLICY_LOCK_REASON });
      continue;
    }
    (tokens as Record<BrandTokenKey, unknown>)[key] = value;
  }

  return {
    snapshot: {
      ...tokens,
      tenantId: policy.tenantId,
      policyVersion: policy.version,
      resolvedAt: now,
    },
    rejectedOverrideKeys,
  };
}
