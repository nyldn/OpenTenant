/**
 * Module registry and tenant navigation configuration (spec sections 10.2, 11).
 */
import type { TenantId } from "@opentenant/auth";

export type ModuleOwnership =
  | { readonly scope: "platform" }
  | { readonly scope: "installation"; readonly installationId: string }
  | {
      readonly scope: "tenant";
      readonly installationId: string;
      readonly tenantId: TenantId;
    };

export interface ModulePromotionProvenance {
  readonly sourceModuleKey: string;
  readonly sourceVersion: string;
  readonly sourceArtifactDigest: string;
  readonly sourceTenantId: TenantId;
  readonly reviewedByUserId: string;
  readonly publishedByUserId: string;
  /** Immutable UTC timestamp captured by value, not a mutable Date object. */
  readonly reviewedAt: string;
}

export type ModuleDigestKind = "sha256_artifact" | "legacy_identity";

export interface ModuleCatalogEntry {
  readonly moduleKey: string;
  readonly version: string;
  readonly runtime: "native" | "remote";
  readonly enabledByDefault: boolean;
  readonly artifactDigest: string;
  readonly digestKind: ModuleDigestKind;
  readonly createdByUserId: string | null;
  readonly ownership: ModuleOwnership;
  readonly promotion: ModulePromotionProvenance | null;
}

export interface TenantModuleAssignmentTarget {
  readonly installationId: string;
  readonly tenantId: TenantId;
}

export interface CreateTenantPrivateModuleInput {
  readonly moduleKey: string;
  readonly version: string;
  readonly runtime: "native" | "remote";
  readonly installationId: string;
  readonly tenantId: TenantId;
  readonly artifactDigest: string;
  readonly createdByUserId: string;
}

export interface ReviewedModulePromotion {
  readonly sourceArtifactDigest: string;
  readonly reviewedByUserId: string;
  readonly reviewedAt: Date;
  readonly publishedByUserId: string;
}

export interface ModulePromotionTarget {
  readonly moduleKey: string;
  readonly version: string;
  readonly artifactDigest: string;
}

const MODULE_KEY = /^[a-z][a-z0-9-]{1,63}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OWNER_ID = /^[a-z][a-z0-9_-]{2,127}$/u;
const DNS_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function isValidModuleKey(moduleKey: string): boolean {
  return MODULE_KEY.test(moduleKey);
}

function normalizedRemoteModuleHost(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (!DNS_HOSTNAME.test(host) || host === "localhost" || host.endsWith(".localhost")) return null;
  // URL canonicalizes non-standard IPv4 forms before this check. Remote
  // module destinations must be provider-managed DNS names, never IP literals.
  try {
    const parsed = new URL(`https://${host}/`);
    if (parsed.hostname !== host || parsed.port !== "" || /^\d+(?:\.\d+){3}$/u.test(host)) return null;
  } catch {
    return null;
  }
  return host;
}

/** Parses an exact, comma-separated deployment-host allowlist. Invalid config fails closed. */
export function parseRemoteModuleHostAllowlist(value: string | undefined): readonly string[] {
  if (!value) return Object.freeze([]);
  const hosts = value.split(",").map((entry) => normalizedRemoteModuleHost(entry));
  if (hosts.some((host) => host === null)) {
    throw new Error("Remote module host allowlist contains an invalid deployment hostname");
  }
  return Object.freeze([...new Set(hosts as string[])]);
}

/** Allows only standard HTTPS URLs on exact provider-managed deployment hosts. */
export function isAllowedRemoteModuleUrl(remoteUrl: string, allowedHosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
  ) return false;
  const host = normalizedRemoteModuleHost(url.hostname);
  if (!host) return false;
  const normalizedAllowed = allowedHosts.map(normalizedRemoteModuleHost);
  return !normalizedAllowed.includes(null) && normalizedAllowed.includes(host);
}

function assertModuleIdentity(moduleKey: string, version: string, artifactDigest: string): void {
  if (!isValidModuleKey(moduleKey)) throw new Error("Module requires a valid module key");
  if (!VERSION.test(version)) throw new Error("Module requires a valid version");
  if (!SHA256.test(artifactDigest)) throw new Error("Module requires a SHA-256 artifact digest");
}

function assertOwnerId(value: string, label: string): void {
  if (!OWNER_ID.test(value)) throw new Error(`Module requires a valid ${label}`);
}

function exactOwnership(value: unknown): ModuleOwnership | null {
  if (value === null || typeof value !== "object") return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return null;
    const read = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && "value" in descriptor ? descriptor.value : undefined;
    };
    const scope = read("scope");
    if (scope === "platform" && keys.length === 1) return { scope };
    const installationId = read("installationId");
    if (
      scope === "installation"
      && keys.length === 2
      && typeof installationId === "string"
      && OWNER_ID.test(installationId)
    ) {
      return { scope, installationId };
    }
    const tenantId = read("tenantId");
    if (
      scope === "tenant"
      && keys.length === 3
      && typeof installationId === "string"
      && typeof tenantId === "string"
      && OWNER_ID.test(installationId)
      && OWNER_ID.test(tenantId)
    ) {
      return { scope, installationId, tenantId: tenantId as TenantId };
    }
    return null;
  } catch {
    return null;
  }
}

/** Tenant-created modules are private by construction, never by caller-selected scope. */
export function createTenantPrivateModule(input: CreateTenantPrivateModuleInput): ModuleCatalogEntry {
  assertModuleIdentity(input.moduleKey, input.version, input.artifactDigest);
  assertOwnerId(input.installationId, "installation identity");
  assertOwnerId(input.tenantId, "tenant identity");
  assertOwnerId(input.createdByUserId, "module creator");
  return Object.freeze({
    moduleKey: input.moduleKey,
    version: input.version,
    runtime: input.runtime,
    enabledByDefault: false,
    artifactDigest: input.artifactDigest,
    digestKind: "sha256_artifact",
    createdByUserId: input.createdByUserId,
    ownership: Object.freeze({
      scope: "tenant" as const,
      installationId: input.installationId,
      tenantId: input.tenantId,
    }),
    promotion: null,
  });
}

/** Closed-scope assignment policy. Unknown ownership values fail closed. */
export function canAssignModuleToTenant(
  module: ModuleCatalogEntry,
  target: TenantModuleAssignmentTarget,
): boolean {
  if (!OWNER_ID.test(target.installationId) || !OWNER_ID.test(target.tenantId)) return false;
  const ownership = exactOwnership(module.ownership);
  if (!ownership) return false;
  switch (ownership.scope) {
    case "platform":
      return true;
    case "installation":
      return ownership.installationId === target.installationId;
    case "tenant":
      return ownership.installationId === target.installationId
        && ownership.tenantId === target.tenantId;
    default:
      return false;
  }
}

/**
 * Creates a reviewed installation-owned copy. The source is read-only input;
 * promotion cannot rewrite its identity, ownership, version, or digest.
 */
export function copyReviewedModuleForInstallation(input: {
  readonly source: ModuleCatalogEntry;
  readonly review: ReviewedModulePromotion;
  readonly target: ModulePromotionTarget;
}): ModuleCatalogEntry {
  const { source, review, target } = input;
  const sourceOwnership = exactOwnership(source.ownership);
  if (!sourceOwnership || sourceOwnership.scope !== "tenant") {
    throw new Error("Module promotion requires a valid tenant-private source");
  }
  assertModuleIdentity(source.moduleKey, source.version, source.artifactDigest);
  if (
    !["native", "remote"].includes(source.runtime)
    || source.enabledByDefault !== false
    || source.promotion !== null
    || typeof source.createdByUserId !== "string"
    || !OWNER_ID.test(source.createdByUserId)
  ) {
    throw new Error("Module promotion requires a valid tenant-private source");
  }
  if (review.sourceArtifactDigest !== source.artifactDigest) {
    throw new Error("Module promotion review does not match the source artifact");
  }
  if (source.digestKind !== "sha256_artifact") {
    throw new Error("Module promotion requires an artifact-backed source digest");
  }
  if (!OWNER_ID.test(review.reviewedByUserId)) {
    throw new Error("Module promotion requires a valid reviewer");
  }
  if (!OWNER_ID.test(review.publishedByUserId)) {
    throw new Error("Module promotion requires a valid publisher");
  }
  if (!(review.reviewedAt instanceof Date) || !Number.isFinite(review.reviewedAt.getTime())) {
    throw new Error("Module promotion requires a valid review time");
  }
  assertModuleIdentity(target.moduleKey, target.version, target.artifactDigest);
  if (target.moduleKey === source.moduleKey) {
    throw new Error("Module promotion requires a new module identity");
  }
  if (target.version === source.version) {
    throw new Error("Module promotion requires a new module version");
  }
  if (target.artifactDigest === source.artifactDigest) {
    throw new Error("Module promotion requires a new artifact digest");
  }

  const promotion = Object.freeze({
    sourceModuleKey: source.moduleKey,
    sourceVersion: source.version,
    sourceArtifactDigest: source.artifactDigest,
    sourceTenantId: sourceOwnership.tenantId,
    reviewedByUserId: review.reviewedByUserId,
    publishedByUserId: review.publishedByUserId,
    reviewedAt: review.reviewedAt.toISOString(),
  });
  return Object.freeze({
    moduleKey: target.moduleKey,
    version: target.version,
    runtime: source.runtime,
    enabledByDefault: false,
    artifactDigest: target.artifactDigest,
    digestKind: "sha256_artifact",
    createdByUserId: review.publishedByUserId,
    ownership: Object.freeze({
      scope: "installation" as const,
      installationId: sourceOwnership.installationId,
    }),
    promotion,
  });
}

export interface TenantModule {
  tenantId: TenantId;
  moduleKey: string;
  enabled: boolean;
  /** Validated against the module manifest settings schema. */
  settings: Record<string, unknown>;
}

/**
 * Versioned tenant navigation override, stored separately from the module
 * registry. Only fields a manifest marks configurable may appear here.
 * Overrides never grant entitlement, create routes, or weaken permissions;
 * unknown or stale item IDs fail validation and produce no navigation entry.
 */
export interface NavigationOverride {
  tenantId: TenantId;
  /** Stable navigation item ID from the module manifest. */
  itemId: string;
  label?: string;
  group?: string;
  order?: number;
  visible?: boolean;
  /** Set by platform admins to freeze a field against tenant edits. */
  lockedFields: ReadonlyArray<"label" | "group" | "order" | "visible">;
  version: number;
}
