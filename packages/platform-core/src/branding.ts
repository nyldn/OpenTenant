/**
 * Typed brand model (architecture spec section 10). No arbitrary CSS.
 *
 * Precedence when resolving a brand snapshot:
 *   platform defaults -> platform-admin tenant defaults (with locks)
 *   -> tenant-admin overrides (unlocked fields only)
 *   -> module presentation mappings.
 */
import type { TenantId } from "@opentenant/auth";

export interface BrandTokens {
  displayName: string;
  logoUrl: string | null;
  /** Square mark for compact surfaces. */
  markUrl: string | null;
  faviconUrl: string | null;
  /** Key selecting the compiled CSS token theme (html[data-brand=...]). */
  cssBrandKey: string;
  colorPrimary: string;
  colorBackground: string;
  colorForeground: string;
  fontFamilyBody: string;
  fontFamilyHeading: string;
  supportEmail: string | null;
  legalLinks: ReadonlyArray<{ label: string; url: string }>;
  reportLabel: string | null;
  exportFilenameSuffix: string | null;
  coBrandingRequired: boolean;
}

export type BrandTokenKey = keyof BrandTokens;

export const BRAND_POLICY_LOCK_REASON = "locked_by_policy" as const;

export const BRAND_TOKEN_KEYS = [
  "displayName",
  "logoUrl",
  "markUrl",
  "faviconUrl",
  "cssBrandKey",
  "colorPrimary",
  "colorBackground",
  "colorForeground",
  "fontFamilyBody",
  "fontFamilyHeading",
  "supportEmail",
  "legalLinks",
  "reportLabel",
  "exportFilenameSuffix",
  "coBrandingRequired",
] as const satisfies ReadonlyArray<BrandTokenKey>;

const BRAND_TOKEN_KEY_SET: ReadonlySet<string> = new Set(BRAND_TOKEN_KEYS);

export function isBrandTokenKey(value: string): value is BrandTokenKey {
  return BRAND_TOKEN_KEY_SET.has(value);
}

export interface TenantBrandPolicy {
  tenantId: TenantId;
  /** Values set by platform admins as tenant defaults. */
  defaults: Partial<BrandTokens>;
  /** Keys tenant admins may not override (legal links, mandatory co-branding, ...). */
  lockedKeys: ReadonlyArray<BrandTokenKey>;
  /** Tenant-admin overrides; entries for locked keys are invalid and rejected. */
  overrides: Partial<BrandTokens>;
  version: number;
}

/**
 * The immutable snapshot handed to shell, modules, PDF, print, and metadata
 * so every surface renders the same resolved brand.
 */
export interface BrandSnapshot extends BrandTokens {
  tenantId: TenantId;
  policyVersion: number;
  resolvedAt: Date;
}
