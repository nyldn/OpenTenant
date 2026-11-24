import { describe, expect, it } from "vitest";
import type { TenantId } from "@opentenant/auth";
import {
  canAssignModuleToTenant,
  copyReviewedModuleForInstallation,
  createTenantPrivateModule,
  isAllowedRemoteModuleUrl,
  isValidModuleKey,
  parseRemoteModuleHostAllowlist,
  type ModuleCatalogEntry,
} from "./index";

const tenantA = "ten_alpha" as TenantId;
const tenantB = "ten_beta" as TenantId;
const sourceDigest = "a".repeat(64);
const promotedDigest = "b".repeat(64);

function tenantPrivateModule(): ModuleCatalogEntry {
  return createTenantPrivateModule({
    moduleKey: "tenant-insights",
    version: "1.0.0",
    runtime: "remote",
    installationId: "ins_example",
    tenantId: tenantA,
    artifactDigest: sourceDigest,
    createdByUserId: "user_creator",
  });
}

describe("module ownership", () => {
  it("uses one 64-character module-key boundary for creation and runtime routing", () => {
    const longestKey = `m${"a".repeat(63)}`;
    expect(isValidModuleKey(longestKey)).toBe(true);
    expect(isValidModuleKey(`${longestKey}a`)).toBe(false);
    expect(createTenantPrivateModule({
      moduleKey: longestKey,
      version: "1.0.0",
      runtime: "remote",
      installationId: "ins_example",
      tenantId: tenantA,
      artifactDigest: sourceDigest,
      createdByUserId: "user_creator",
    }).moduleKey).toBe(longestKey);
  });

  it("allows remote modules only on exact provider-managed deployment hosts", () => {
    const hosts = parseRemoteModuleHostAllowlist("module.example.test, deployments.example.test");
    expect(isAllowedRemoteModuleUrl("https://module.example.test/app", hosts)).toBe(true);
    expect(isAllowedRemoteModuleUrl("https://evil.module.example.test/app", hosts)).toBe(false);
    expect(isAllowedRemoteModuleUrl("https://module.example.test:8443/app", hosts)).toBe(false);
    expect(isAllowedRemoteModuleUrl("https://127.0.0.1/app", ["127.0.0.1"])).toBe(false);
    expect(isAllowedRemoteModuleUrl("https://localhost/app", ["localhost"])).toBe(false);
    expect(() => parseRemoteModuleHostAllowlist("https://module.example.test"))
      .toThrow("invalid deployment hostname");
  });

  it("creates tenant modules as private and denies assignment outside the owning tenant", () => {
    const module = tenantPrivateModule();

    expect(module.ownership).toEqual({
      scope: "tenant",
      installationId: "ins_example",
      tenantId: tenantA,
    });
    expect(canAssignModuleToTenant(module, {
      installationId: "ins_example",
      tenantId: tenantA,
    })).toBe(true);
    expect(canAssignModuleToTenant(module, {
      installationId: "ins_example",
      tenantId: tenantB,
    })).toBe(false);
    expect(canAssignModuleToTenant(module, {
      installationId: "ins_other",
      tenantId: tenantA,
    })).toBe(false);
  });

  it("bounds installation-owned modules to their installation and fails closed on unknown scope", () => {
    const installationModule: ModuleCatalogEntry = {
      ...tenantPrivateModule(),
      ownership: { scope: "installation", installationId: "ins_example" },
    };
    expect(canAssignModuleToTenant(installationModule, {
      installationId: "ins_example",
      tenantId: tenantB,
    })).toBe(true);
    expect(canAssignModuleToTenant(installationModule, {
      installationId: "ins_other",
      tenantId: tenantB,
    })).toBe(false);
    expect(canAssignModuleToTenant({
      ...installationModule,
      ownership: { scope: "platform" },
    }, {
      installationId: "",
      tenantId: tenantB,
    })).toBe(false);

    const ambiguous = {
      ...installationModule,
      ownership: { scope: "shared" },
    } as unknown as ModuleCatalogEntry;
    expect(canAssignModuleToTenant(ambiguous, {
      installationId: "ins_example",
      tenantId: tenantA,
    })).toBe(false);
    expect(canAssignModuleToTenant({
      ...installationModule,
      ownership: { scope: "platform", installationId: "ins_other" },
    } as unknown as ModuleCatalogEntry, {
      installationId: "ins_example",
      tenantId: tenantA,
    })).toBe(false);
    expect(canAssignModuleToTenant({
      ...installationModule,
      ownership: { scope: "installation", installationId: "ins_example", tenantId: tenantB },
    } as unknown as ModuleCatalogEntry, {
      installationId: "ins_example",
      tenantId: tenantA,
    })).toBe(false);
  });

  it("promotes only a reviewed tenant artifact into a new immutable installation copy", () => {
    const source = tenantPrivateModule();
    const sourceBefore = structuredClone(source);
    const reviewedAt = new Date("2026-07-22T09:00:00.000Z");

    const promoted = copyReviewedModuleForInstallation({
      source,
      review: {
        sourceArtifactDigest: sourceDigest,
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt,
      },
      target: {
        moduleKey: "shared-insights",
        version: "1.1.0",
        artifactDigest: promotedDigest,
      },
    });

    expect(source).toEqual(sourceBefore);
    expect(promoted).toMatchObject({
      moduleKey: "shared-insights",
      version: "1.1.0",
      artifactDigest: promotedDigest,
      ownership: { scope: "installation", installationId: "ins_example" },
      promotion: {
        sourceModuleKey: "tenant-insights",
        sourceVersion: "1.0.0",
        sourceArtifactDigest: sourceDigest,
        sourceTenantId: tenantA,
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt: reviewedAt.toISOString(),
      },
    });
    expect(Object.isFrozen(promoted)).toBe(true);
    expect(Object.isFrozen(promoted.ownership)).toBe(true);
    expect(Object.isFrozen(promoted.promotion)).toBe(true);
    expect(promoted.digestKind).toBe("sha256_artifact");
  });

  it("rejects unreviewed, stale, in-place, and non-private promotion attempts", () => {
    const source = tenantPrivateModule();
    const reviewedAt = new Date("2026-07-22T09:00:00.000Z");
    const target = {
      moduleKey: "shared-insights",
      version: "1.1.0",
      artifactDigest: promotedDigest,
    };

    expect(() => copyReviewedModuleForInstallation({
      source,
      review: {
        sourceArtifactDigest: "c".repeat(64),
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt,
      },
      target,
    })).toThrow("review does not match");

    expect(() => copyReviewedModuleForInstallation({
      source,
      review: {
        sourceArtifactDigest: sourceDigest,
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt,
      },
      target: { ...target, moduleKey: source.moduleKey },
    })).toThrow("new module identity");

    expect(() => copyReviewedModuleForInstallation({
      source,
      review: {
        sourceArtifactDigest: sourceDigest,
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt,
      },
      target: { ...target, version: source.version },
    })).toThrow("new module version");

    expect(() => copyReviewedModuleForInstallation({
      source,
      review: {
        sourceArtifactDigest: sourceDigest,
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt,
      },
      target: { ...target, artifactDigest: sourceDigest },
    })).toThrow("new artifact digest");

    const installationOwned: ModuleCatalogEntry = {
      ...source,
      ownership: { scope: "installation", installationId: "ins_example" },
    };
    expect(() => copyReviewedModuleForInstallation({
      source: installationOwned,
      review: {
        sourceArtifactDigest: sourceDigest,
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt,
      },
      target,
    })).toThrow("tenant-private source");

    expect(() => copyReviewedModuleForInstallation({
      source: { ...source, digestKind: "legacy_identity" },
      review: {
        sourceArtifactDigest: sourceDigest,
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt,
      },
      target,
    })).toThrow("artifact-backed source digest");

    expect(() => copyReviewedModuleForInstallation({
      source: {
        ...source,
        ownership: { scope: "tenant", installationId: "", tenantId: tenantA },
      },
      review: {
        sourceArtifactDigest: sourceDigest,
        reviewedByUserId: "user_reviewer",
        publishedByUserId: "user_publisher",
        reviewedAt,
      },
      target,
    })).toThrow("valid tenant-private source");
  });
});
