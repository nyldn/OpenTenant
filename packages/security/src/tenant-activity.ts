import type { AuditActor, AuditEvent } from "./index";

export type TenantActivityMetadataValue = string | number | boolean | null;

export interface TenantActivityRecord {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly actor: "Tenant user" | "System" | "Support operator" | "Platform operator" | "Unknown actor";
  readonly action: TenantActivityAction;
  readonly subject: string;
  readonly summary: string;
  readonly metadata: Readonly<Record<string, TenantActivityMetadataValue>>;
}

type MetadataValidator = (value: unknown) => value is TenantActivityMetadataValue;

interface TenantActivityActionPolicy {
  readonly summary: string;
  readonly metadataKeys: readonly string[];
}

const policy = <const Keys extends readonly string[]>(
  summary: string,
  metadataKeys: Keys,
): Readonly<TenantActivityActionPolicy & { readonly metadataKeys: Keys }> =>
  Object.freeze({ summary, metadataKeys: Object.freeze(metadataKeys) });

/**
 * Server-owned, default-deny tenant display policy. Adding an audit action does
 * not make it tenant-visible; it must be deliberately added here with its own
 * metadata allowlist and validator below.
 */
export const TENANT_ACTIVITY_ACTION_POLICY = Object.freeze({
  "brand.overrides_changed": policy("Brand settings changed", ["changedKeys"]),
  "brand.proposal.applied": policy("Brand proposal applied", ["policyVersion"]),
  "brand.proposal.discarded": policy("Brand proposal discarded", []),
  "brand.proposal.edited": policy("Brand proposal edited", []),
  "brand.proposal.reviewed": policy("Brand proposal reviewed", []),
  "brand.voice_profile.published": policy("Brand voice profile published", ["version"]),
  "brand.voice_profile.revoked": policy("Brand voice profile revoked", ["version"]),
  "domain_metadata.changed": policy("Domain settings changed", ["changedKeys"]),
  "member.invited": policy("Member invited", ["role"]),
  "member.removed": policy("Member removed", ["role", "status"]),
  "module.access_mode_changed": policy("Module access changed", ["mode", "passcodeRotated"]),
  "module.assigned": policy("Module assignment changed", ["version", "enabled"]),
  "module_metadata.changed": policy("Module settings changed", ["changedKeys"]),
  "navigation.override_changed": policy("Navigation settings changed", ["itemId", "changedFields"]),
  "support.policy_changed": policy("Support access policy changed", ["enabled"]),
  "support.session_ended": policy("Support session ended", []),
  "support.session_started": policy("Support session started", []),
  "tenant.created": policy("Tenant created", ["dataRegion"]),
  "tenant.provisioned": policy("Tenant provisioned", []),
} as const);

export type TenantActivityAction = keyof typeof TENANT_ACTIVITY_ACTION_POLICY;

const oneOf = <const Values extends readonly TenantActivityMetadataValue[]>(
  ...values: Values
): MetadataValidator => (value: unknown): value is Values[number] => values.includes(value as never);

const positiveInteger: MetadataValidator = (value): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const booleanValue: MetadataValidator = (value): value is boolean => typeof value === "boolean";
const safeToken = (maximum: number): MetadataValidator => (value): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum
  && /^[A-Za-z0-9._-]+$/u.test(value);
const closedCsv = (allowed: readonly string[]): MetadataValidator => (value): value is string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 100) return false;
  const fields = value.split(",");
  return fields.length <= allowed.length
    && new Set(fields).size === fields.length
    && fields.every((field) => allowed.includes(field));
};

const METADATA_VALIDATORS: Readonly<Record<TenantActivityAction, Readonly<Record<string, MetadataValidator>>>>
  = Object.freeze({
    "brand.overrides_changed": Object.freeze({
      changedKeys: closedCsv(["displayName", "logoUrl", "exportFilenameSuffix"]),
    }),
    "brand.proposal.applied": Object.freeze({ policyVersion: positiveInteger }),
    "brand.proposal.discarded": Object.freeze({}),
    "brand.proposal.edited": Object.freeze({}),
    "brand.proposal.reviewed": Object.freeze({}),
    "brand.voice_profile.published": Object.freeze({ version: positiveInteger }),
    "brand.voice_profile.revoked": Object.freeze({ version: positiveInteger }),
    "domain_metadata.changed": Object.freeze({
      changedKeys: closedCsv(["displayLabel", "verificationNote"]),
    }),
    "member.invited": Object.freeze({
      role: oneOf("tenant_owner", "tenant_admin", "tenant_member"),
    }),
    "member.removed": Object.freeze({
      role: oneOf("tenant_owner", "tenant_admin", "tenant_member"),
      status: oneOf("active", "invited", "suspended"),
    }),
    "module.access_mode_changed": Object.freeze({
      mode: oneOf("identity", "passcode"),
      passcodeRotated: booleanValue,
    }),
    "module.assigned": Object.freeze({ version: safeToken(64), enabled: booleanValue }),
    "module_metadata.changed": Object.freeze({
      changedKeys: closedCsv(["displayLabel", "supportNote"]),
    }),
    "navigation.override_changed": Object.freeze({
      itemId: safeToken(64),
      changedFields: closedCsv(["label", "order", "visible"]),
    }),
    "support.policy_changed": Object.freeze({ enabled: booleanValue }),
    "support.session_ended": Object.freeze({}),
    "support.session_started": Object.freeze({}),
    "tenant.created": Object.freeze({ dataRegion: safeToken(32) }),
    "tenant.provisioned": Object.freeze({}),
  });

function isTenantActivityAction(action: string): action is TenantActivityAction {
  return Object.hasOwn(TENANT_ACTIVITY_ACTION_POLICY, action);
}

function actorDisplay(actor: unknown): TenantActivityRecord["actor"] {
  if (typeof actor !== "object" || actor === null || !("kind" in actor)) return "Unknown actor";
  const candidate = actor as Partial<AuditActor> & Record<string, unknown>;
  if (candidate.kind === "user" && typeof candidate.userId === "string" && candidate.userId.length > 0) {
    return "Tenant user";
  }
  if (candidate.kind === "system" && typeof candidate.job === "string" && candidate.job.length > 0) {
    return "System";
  }
  if (candidate.kind === "installation_owner"
    && typeof candidate.userId === "string" && candidate.userId.length > 0) {
    return "Support operator";
  }
  if (candidate.kind === "platform_admin"
    && typeof candidate.userId === "string" && candidate.userId.length > 0) {
    return "Platform operator";
  }
  return "Unknown actor";
}

const SAFE_SUBJECT = /^[A-Za-z0-9._:-]+$/u;

function subjectDisplay(subject: unknown): string {
  return typeof subject === "string"
    && subject.length > 0
    && subject.length <= 200
    && SAFE_SUBJECT.test(subject)
    ? subject
    : "Affected resource";
}

function metadataFor(event: AuditEvent, action: TenantActivityAction, navigationItemIds: ReadonlySet<string>): TenantActivityRecord["metadata"] {
  const metadata: Record<string, TenantActivityMetadataValue> = {};
  const validators = METADATA_VALIDATORS[action];
  for (const key of TENANT_ACTIVITY_ACTION_POLICY[action].metadataKeys) {
    const value: unknown = event.detail?.[key];
    if (action === "navigation.override_changed" && key === "itemId" && !navigationItemIds.has(String(value))) continue;
    if (validators[key]?.(value)) metadata[key] = value;
  }
  return Object.freeze(metadata);
}

/** Project canonical audit events through the tenant-facing visibility boundary. */
export function projectTenantActivity(
  events: readonly AuditEvent[],
  tenantId: string,
  limit = 100,
  navigationItemIds: readonly string[] = [],
): readonly TenantActivityRecord[] {
  if (typeof tenantId !== "string" || tenantId.length < 1) {
    throw new TypeError("A requested tenantId is required");
  }
  const boundedLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 100, 1), 100);
  const records = events
    .filter((event) => event.tenantId === tenantId && isTenantActivityAction(event.action))
    .filter((event) => Number.isSafeInteger(event.sequence) && event.sequence >= 0
      && event.occurredAt instanceof Date && Number.isFinite(event.occurredAt.getTime()))
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()
      || right.sequence - left.sequence)
    .slice(0, boundedLimit)
    .map((event): TenantActivityRecord => {
      const action = event.action as TenantActivityAction;
      return Object.freeze({
        sequence: event.sequence,
        occurredAt: event.occurredAt.toISOString(),
        actor: actorDisplay(event.actor),
        action,
        subject: subjectDisplay(event.subject),
        summary: TENANT_ACTIVITY_ACTION_POLICY[action].summary,
        metadata: metadataFor(event, action, new Set(navigationItemIds)),
      });
    });
  return Object.freeze(records);
}
