import { describe, expect, it } from "vitest";
import type { TenantId } from "@opentenant/auth";
import { BRAND_POLICY_LOCK_REASON, type TenantBrandPolicy } from "./branding";
import { PLATFORM_BRAND_DEFAULTS, resolveBrandSnapshot } from "./resolve-brand";

const tenantId = "tenant_brand_tests" as TenantId;

function policy(changes: Partial<TenantBrandPolicy> = {}): TenantBrandPolicy {
  return {
    tenantId,
    defaults: {},
    lockedKeys: [],
    overrides: {},
    version: 1,
    ...changes,
  };
}

describe("resolveBrandSnapshot", () => {
  it("uses the stable policy-lock reason", () => {
    expect(BRAND_POLICY_LOCK_REASON).toBe("locked_by_policy");
  });

  it("fills every token from platform defaults when policy is empty", () => {
    const resolvedAt = new Date("2026-07-15T12:00:00.000Z");

    const result = resolveBrandSnapshot(policy(), resolvedAt);

    expect(result.snapshot).toEqual({
      ...PLATFORM_BRAND_DEFAULTS,
      tenantId,
      policyVersion: 1,
      resolvedAt,
    });
    expect(result.rejectedOverrideKeys).toEqual([]);
  });

  it("applies tenant defaults over platform defaults and tenant overrides over tenant defaults", () => {
    const result = resolveBrandSnapshot(
      policy({
        defaults: {
          displayName: "Tenant Default",
          colorPrimary: "#112233",
          supportEmail: "default@example.test",
        },
        overrides: {
          displayName: "Tenant Override",
          colorPrimary: "#445566",
        },
      }),
      new Date("2026-07-15T12:00:00.000Z"),
    );

    expect(result.snapshot.displayName).toBe("Tenant Override");
    expect(result.snapshot.colorPrimary).toBe("#445566");
    expect(result.snapshot.supportEmail).toBe("default@example.test");
    expect(result.snapshot.colorBackground).toBe(PLATFORM_BRAND_DEFAULTS.colorBackground);
  });

  it("ignores and reports overrides on locked keys while keeping the locked default", () => {
    const result = resolveBrandSnapshot(
      policy({
        defaults: {
          displayName: "Locked Tenant Default",
          coBrandingRequired: true,
        },
        lockedKeys: ["displayName", "coBrandingRequired"],
        overrides: {
          displayName: "Rejected Override",
          colorPrimary: "#445566",
          coBrandingRequired: false,
        },
      }),
      new Date("2026-07-15T12:00:00.000Z"),
    );

    expect(result.snapshot.displayName).toBe("Locked Tenant Default");
    expect(result.snapshot.colorPrimary).toBe("#445566");
    expect(result.snapshot.coBrandingRequired).toBe(true);
    expect(result.rejectedOverrideKeys).toEqual([
      { key: "displayName", reason: "locked_by_policy" },
      { key: "coBrandingRequired", reason: "locked_by_policy" },
    ]);
  });

  it("reports exactly one locked override and still resolves an unlocked override", () => {
    const result = resolveBrandSnapshot(
      policy({
        defaults: { displayName: "Locked Tenant Default" },
        lockedKeys: ["displayName"],
        overrides: {
          displayName: "Rejected Override",
          colorPrimary: "#123456",
        },
      }),
      new Date("2026-07-15T12:00:00.000Z"),
    );

    expect(result.snapshot.displayName).toBe("Locked Tenant Default");
    expect(result.snapshot.colorPrimary).toBe("#123456");
    expect(result.rejectedOverrideKeys).toEqual([
      { key: "displayName", reason: "locked_by_policy" },
    ]);
  });

  it("resolves every override and reports no rejections when no keys are locked", () => {
    const resolvedAt = new Date("2026-07-16T09:30:00.000Z");
    const result = resolveBrandSnapshot(
      policy({
        version: 7,
        overrides: {
          displayName: "Literal Brand",
          logoUrl: "https://example.test/logo.svg",
          markUrl: "https://example.test/mark.svg",
          faviconUrl: "https://example.test/favicon.ico",
          cssBrandKey: "literal-brand",
          colorPrimary: "#123456",
          colorBackground: "#fefefe",
          colorForeground: "#101010",
          fontFamilyBody: "Literal Body",
          fontFamilyHeading: "Literal Heading",
          supportEmail: "support@example.test",
          legalLinks: [{ label: "Privacy", url: "https://example.test/privacy" }],
          reportLabel: "Literal Report",
          exportFilenameSuffix: "literal-export",
          coBrandingRequired: true,
        },
      }),
      resolvedAt,
    );

    expect(result.snapshot).toEqual({
      tenantId: "tenant_brand_tests",
      policyVersion: 7,
      resolvedAt,
      displayName: "Literal Brand",
      logoUrl: "https://example.test/logo.svg",
      markUrl: "https://example.test/mark.svg",
      faviconUrl: "https://example.test/favicon.ico",
      cssBrandKey: "literal-brand",
      colorPrimary: "#123456",
      colorBackground: "#fefefe",
      colorForeground: "#101010",
      fontFamilyBody: "Literal Body",
      fontFamilyHeading: "Literal Heading",
      supportEmail: "support@example.test",
      legalLinks: [{ label: "Privacy", url: "https://example.test/privacy" }],
      reportLabel: "Literal Report",
      exportFilenameSuffix: "literal-export",
      coBrandingRequired: true,
    });
    expect(result.rejectedOverrideKeys).toEqual([]);
  });

  it("carries tenantId, policyVersion, and resolvedAt into the snapshot", () => {
    const resolvedAt = new Date("2026-07-15T18:30:00.000Z");

    const result = resolveBrandSnapshot(policy({ version: 42 }), resolvedAt);

    expect(result.snapshot.tenantId).toBe(tenantId);
    expect(result.snapshot.policyVersion).toBe(42);
    expect(result.snapshot.resolvedAt).toBe(resolvedAt);
  });
});
