import { randomUUID } from "node:crypto";

import { MAX_SCOPE_VALUE_LENGTH, MAX_SCOPE_VALUES_PER_SOURCE, resolveEffectiveAuthority, type AuthorityResolutionInput } from "./authority";
import { type DeveloperProfileVersion } from "./profiles";
import { MAX_AUTHORITY_STALENESS_MS, requiresSynchronousRevocationCheck } from "./revocation";
import { ASSIGNABLE_PERMISSION_SLUGS, isAssignablePermissionSlug, type AssignablePermissionSlug, type DeveloperRiskClass } from "./slugs";
import { DEVELOPER_TOOL_DESCRIPTORS, type DeveloperResourceType } from "./tools";
import { DEVELOPER_MCP_AUDIT_FIELDS, assertDeveloperMcpAuditRecord, type DeveloperMcpAuditAppendAdapter, type DeveloperMcpAuditDecisionCode, type DeveloperMcpAuditRecord, type UncommittedDeveloperMcpAuditRecord } from "./audit";

const MAX_CONTEXT_STRING_LENGTH = 128;
const MAX_LOCAL_RESOURCES = 1_024;
const MAX_LOCAL_GRANTS = 2_048;
const opaqueIdPattern = /^[0-9a-f]{32}$/;
const safeStringPattern = /^[\x20-\x7e]+$/;
const descriptorByName = new Map(DEVELOPER_TOOL_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]));

export type DeveloperMcpPrincipal = Readonly<{ tenantId: string; userId: string; clientId: string }>;
export type DeveloperMcpAuthoritySource = AuthorityResolutionInput & Readonly<{ resolvedAtMs: number }>;
export type DeveloperMcpResourceReference = Readonly<{ resourceType: DeveloperResourceType; resourceId: string }>;
export type DeveloperMcpRevocationMode = "per_call" | "synchronous_high_risk";
export type DeveloperMcpRevocationResult =
  | Readonly<{ status: "revoked" }>
  | Readonly<{ status: "active"; checkedAtMs: number; source: "live" | "cache" }>;
export type DeveloperMcpResourceAuthorizationResult = Readonly<{ status: "allowed" | "denied" }>;

export interface DeveloperMcpRevocationAdapter {
  revalidate(input: Readonly<{
    principal: DeveloperMcpPrincipal;
    requiredSlug: AssignablePermissionSlug;
    mode: DeveloperMcpRevocationMode;
  }>): DeveloperMcpRevocationResult | Promise<DeveloperMcpRevocationResult>;
}

export interface DeveloperMcpResourceAuthorizationAdapter {
  authorize(input: Readonly<{
    principal: DeveloperMcpPrincipal;
    requiredSlug: AssignablePermissionSlug;
    resource: DeveloperMcpResourceReference;
  }>): DeveloperMcpResourceAuthorizationResult | Promise<DeveloperMcpResourceAuthorizationResult>;
}

export type DeveloperMcpCallAuthorizationInput = Readonly<{
  toolName: string;
  authoritySource: DeveloperMcpAuthoritySource;
  principal: DeveloperMcpPrincipal;
  resource: DeveloperMcpResourceReference;
  nowMs: number;
  revocationAdapter: DeveloperMcpRevocationAdapter;
  resourceAuthorizationAdapter: DeveloperMcpResourceAuthorizationAdapter;
  auditAppendAdapter: DeveloperMcpAuditAppendAdapter;
}>;

export type DeveloperMcpCallDenialCode = Exclude<DeveloperMcpAuditDecisionCode, "allowed">;
export type DeveloperMcpCallAuthorizationDecision =
  | Readonly<{ status: "denied"; code: DeveloperMcpCallDenialCode }>
  | Readonly<{
      status: "allowed";
      toolName: string;
      slug: AssignablePermissionSlug;
      risk: DeveloperRiskClass;
      resourceType: DeveloperResourceType;
      resourceId: string;
      profileVersion: DeveloperProfileVersion;
      revocation: Readonly<{ checkedAtMs: number; source: "live" | "cache" }>;
    }>;

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactData(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
  });
}

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CONTEXT_STRING_LENGTH
    && value === value.trim() && safeStringPattern.test(value);
}

function validResourceType(value: unknown): value is DeveloperResourceType {
  return value === "module_project" || value === "module_workspace";
}

function validPrincipal(value: unknown): value is DeveloperMcpPrincipal {
  return exactData(value, ["tenantId", "userId", "clientId"])
    && boundedString(value.tenantId) && boundedString(value.userId) && boundedString(value.clientId);
}

function validResource(value: unknown): value is DeveloperMcpResourceReference {
  return exactData(value, ["resourceType", "resourceId"])
    && validResourceType(value.resourceType) && typeof value.resourceId === "string" && opaqueIdPattern.test(value.resourceId);
}

function validAuthoritySource(value: unknown): value is DeveloperMcpAuthoritySource {
  return exactData(value, ["assignedProfile", "tokenScopes", "consentedClientScopes", "resolvedAtMs"])
    && (value.assignedProfile === null || boundedString(value.assignedProfile))
    && Array.isArray(value.tokenScopes) && value.tokenScopes.length <= MAX_SCOPE_VALUES_PER_SOURCE
    && value.tokenScopes.every((scope) => typeof scope === "string" && scope.length <= MAX_SCOPE_VALUE_LENGTH)
    && Array.isArray(value.consentedClientScopes) && value.consentedClientScopes.length <= MAX_SCOPE_VALUES_PER_SOURCE
    && value.consentedClientScopes.every((scope) => typeof scope === "string" && scope.length <= MAX_SCOPE_VALUE_LENGTH)
    && typeof value.resolvedAtMs === "number";
}

function deny(code: DeveloperMcpCallDenialCode): DeveloperMcpCallAuthorizationDecision {
  return Object.freeze({ status: "denied", code });
}

type AuditSink = Readonly<{ receiver: object; append: DeveloperMcpAuditAppendAdapter["append"] }>;
type AuditIdentity = Pick<DeveloperMcpPrincipal, "clientId" | "userId" | "tenantId"> & DeveloperMcpResourceReference;

function auditSink(input: unknown): AuditSink | null {
  if (typeof input !== "object" || input === null) return null;
  const property = Object.getOwnPropertyDescriptor(input, "auditAppendAdapter");
  if (property === undefined || !("value" in property) || !property.enumerable
    || (typeof property.value !== "object" && typeof property.value !== "function") || property.value === null) return null;
  let owner: object | null = property.value as object;
  while (owner !== null) {
    const method = Object.getOwnPropertyDescriptor(owner, "append");
    if (method !== undefined) {
      return "value" in method && typeof method.value === "function"
        ? { receiver: property.value as object, append: method.value as DeveloperMcpAuditAppendAdapter["append"] }
        : null;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return null;
}

function auditCommon(correlationId: string) {
  return { schemaVersion: "2" as const, correlationId, priorDigest: null, currentDigest: null };
}

async function appendDecision(sink: AuditSink, record: DeveloperMcpAuditRecord, decision: DeveloperMcpCallAuthorizationDecision) {
  const uncommitted = assertDeveloperMcpAuditRecord(record);
  if (uncommitted.priorDigest !== null || uncommitted.currentDigest !== null) throw new TypeError("Developer MCP audit decision must be uncommitted");
  const committed = assertDeveloperMcpAuditRecord(
    await sink.append.call(sink.receiver, uncommitted as UncommittedDeveloperMcpAuditRecord),
  );
  if (committed.priorDigest === null || committed.currentDigest === null
    || DEVELOPER_MCP_AUDIT_FIELDS.some((field) => field !== "priorDigest" && field !== "currentDigest"
      && committed[field] !== uncommitted[field])) {
    throw new TypeError("Developer MCP audit append returned mismatched commit evidence");
  }
  return decision;
}

function activeEvidence(value: unknown, nowMs: number, requireLive: boolean): value is Extract<DeveloperMcpRevocationResult, { status: "active" }> {
  return exactData(value, ["status", "checkedAtMs", "source"])
    && value.status === "active" && typeof value.checkedAtMs === "number" && Number.isFinite(value.checkedAtMs)
    && value.checkedAtMs <= nowMs && nowMs - value.checkedAtMs <= MAX_AUTHORITY_STALENESS_MS
    && (value.source === "live" || value.source === "cache") && (!requireLive || value.source === "live");
}

async function checkRevocation(
  adapter: DeveloperMcpRevocationAdapter,
  principal: DeveloperMcpPrincipal,
  requiredSlug: AssignablePermissionSlug,
  mode: DeveloperMcpRevocationMode,
  nowMs: number,
): Promise<Extract<DeveloperMcpRevocationResult, { status: "active" }> | null> {
  try {
    const result: unknown = await adapter.revalidate(Object.freeze({ principal, requiredSlug, mode }));
    return activeEvidence(result, nowMs, mode === "synchronous_high_risk") ? result : null;
  } catch {
    return null;
  }
}

export async function authorizeDeveloperMcpCall(input: DeveloperMcpCallAuthorizationInput): Promise<DeveloperMcpCallAuthorizationDecision> {
  const sink = auditSink(input);
  if (sink === null) throw new TypeError("Developer MCP audit append adapter is invalid");
  const correlationId = randomUUID();
  const unresolved = () => appendDecision(sink, {
    ...auditCommon(correlationId), contextResolution: "unresolved", decisionCode: "invalid_context",
    toolName: null, slug: null, profileVersion: null, clientId: null, userId: null, tenantId: null,
    resourceType: null, resourceId: null, riskClass: null, authorizationDecision: "deny",
    revocationCheckResult: "not_required", outcome: "denied",
  }, deny("invalid_context"));
  if (!exactData(input, ["toolName", "authoritySource", "principal", "resource", "nowMs", "revocationAdapter", "resourceAuthorizationAdapter", "auditAppendAdapter"])
    || !validPrincipal(input.principal) || !validAuthoritySource(input.authoritySource) || !validResource(input.resource)) return unresolved();
  const identity: AuditIdentity = { ...input.principal, ...input.resource };
  const principalDenial = (code: "invalid_context" | "unknown_tool" | "authority_missing") => appendDecision(sink, {
    ...auditCommon(correlationId), contextResolution: "principal", decisionCode: code,
    toolName: null, slug: null, profileVersion: null, ...identity, riskClass: null,
    authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied",
  }, deny(code));
  if (!Number.isFinite(input.nowMs)) return principalDenial("invalid_context");
  const { resolvedAtMs } = input.authoritySource;
  if (!Number.isFinite(resolvedAtMs) || resolvedAtMs > input.nowMs) return principalDenial("invalid_context");
  if (input.nowMs - resolvedAtMs > MAX_AUTHORITY_STALENESS_MS) return principalDenial("authority_missing");
  if (!boundedString(input.toolName)) return principalDenial("unknown_tool");
  const descriptor = descriptorByName.get(input.toolName);
  if (descriptor === undefined) return principalDenial("unknown_tool");

  const authority = resolveEffectiveAuthority({
    assignedProfile: input.authoritySource.assignedProfile,
    tokenScopes: input.authoritySource.tokenScopes,
    consentedClientScopes: input.authoritySource.consentedClientScopes,
  });
  const completeDenial = (code: "authority_missing" | "resource_denied" | "revoked", profileVersion: DeveloperProfileVersion | null,
    revocationCheckResult: "not_required" | "passed" | "failed") => appendDecision(sink, {
      ...auditCommon(correlationId), contextResolution: "complete", decisionCode: code,
      toolName: descriptor.name, slug: descriptor.slug, profileVersion, ...identity, riskClass: descriptor.risk,
      authorizationDecision: "deny", revocationCheckResult, outcome: "denied",
    } as DeveloperMcpAuditRecord, deny(code));
  if (authority.profileStatus !== "assigned" || authority.profileVersion === null
    || !authority.effectiveSlugs.includes(descriptor.slug)) return completeDenial("authority_missing", authority.profileVersion, "not_required");
  if (input.resource.resourceType !== descriptor.resourceType) return completeDenial("resource_denied", authority.profileVersion, "not_required");

  const principal = Object.freeze({ ...input.principal });
  const resource = Object.freeze({ ...input.resource });
  let revocation = await checkRevocation(input.revocationAdapter, principal, descriptor.slug, "per_call", input.nowMs);
  if (revocation === null) return completeDenial("revoked", authority.profileVersion, "failed");
  try {
    const resourceResult: unknown = await input.resourceAuthorizationAdapter.authorize(Object.freeze({ principal, requiredSlug: descriptor.slug, resource }));
    if (!exactData(resourceResult, ["status"]) || resourceResult.status !== "allowed") return completeDenial("resource_denied", authority.profileVersion, "passed");
  } catch {
    return completeDenial("resource_denied", authority.profileVersion, "passed");
  }
  if (requiresSynchronousRevocationCheck(descriptor.slug)) {
    revocation = await checkRevocation(input.revocationAdapter, principal, descriptor.slug, "synchronous_high_risk", input.nowMs);
    if (revocation === null) return completeDenial("revoked", authority.profileVersion, "failed");
  }
  const decision: DeveloperMcpCallAuthorizationDecision = Object.freeze({
    status: "allowed",
    toolName: descriptor.name,
    slug: descriptor.slug,
    risk: descriptor.risk,
    resourceType: descriptor.resourceType,
    resourceId: resource.resourceId,
    profileVersion: authority.profileVersion,
    revocation: Object.freeze({ checkedAtMs: revocation.checkedAtMs, source: revocation.source }),
  });
  return appendDecision(sink, {
    ...auditCommon(correlationId), contextResolution: "complete", decisionCode: "allowed",
    toolName: descriptor.name, slug: descriptor.slug, profileVersion: authority.profileVersion, ...identity,
    riskClass: descriptor.risk, authorizationDecision: "allow", revocationCheckResult: "passed", outcome: "authorized",
  }, decision);
}

export type LocalDeveloperMcpResourceRecord =
  | Readonly<{ resourceType: "module_project"; resourceId: string; tenantId: string }>
  | Readonly<{ resourceType: "module_workspace"; resourceId: string; tenantId: string; parentProjectId: string }>;
export type LocalDeveloperMcpResourceGrant = Readonly<{
  userId: string;
  resourceType: DeveloperResourceType;
  resourceId: string;
  slugs: readonly AssignablePermissionSlug[];
}>;
export type LocalDeveloperMcpResourceSnapshot = Readonly<{
  resources: readonly LocalDeveloperMcpResourceRecord[];
  grants: readonly LocalDeveloperMcpResourceGrant[];
}>;
export type LocalDeveloperMcpResourceAuthorizationAdapter = DeveloperMcpResourceAuthorizationAdapter & Readonly<{
  snapshot: LocalDeveloperMcpResourceSnapshot;
}>;

function resourceKey(resourceType: DeveloperResourceType, resourceId: string): string {
  return `${resourceType}\u0000${resourceId}`;
}

function invalidSnapshot(): never {
  throw new TypeError("Developer MCP local authorization snapshot is invalid");
}

export function createLocalDeveloperMcpResourceAuthorizationAdapter(value: LocalDeveloperMcpResourceSnapshot): LocalDeveloperMcpResourceAuthorizationAdapter {
  if (!exactData(value, ["resources", "grants"]) || !Array.isArray(value.resources) || !Array.isArray(value.grants)
    || value.resources.length > MAX_LOCAL_RESOURCES || value.grants.length > MAX_LOCAL_GRANTS) invalidSnapshot();
  const resources = new Map<string, LocalDeveloperMcpResourceRecord>();
  const copiedResources = value.resources.map((record: unknown): LocalDeveloperMcpResourceRecord => {
    if (!plainRecord(record) || !validResourceType(record.resourceType) || typeof record.resourceId !== "string"
      || !opaqueIdPattern.test(record.resourceId) || !boundedString(record.tenantId)) invalidSnapshot();
    if (record.resourceType === "module_project") {
      if (!exactData(record, ["resourceType", "resourceId", "tenantId"])) invalidSnapshot();
      return Object.freeze({ resourceType: record.resourceType, resourceId: record.resourceId, tenantId: record.tenantId as string });
    }
    if (!exactData(record, ["resourceType", "resourceId", "tenantId", "parentProjectId"])
      || typeof record.parentProjectId !== "string" || !opaqueIdPattern.test(record.parentProjectId)) invalidSnapshot();
    return Object.freeze({ resourceType: record.resourceType, resourceId: record.resourceId, tenantId: record.tenantId as string, parentProjectId: record.parentProjectId });
  });
  for (const record of copiedResources) {
    const key = resourceKey(record.resourceType, record.resourceId);
    if (resources.has(key)) invalidSnapshot();
    resources.set(key, record);
  }
  for (const record of copiedResources) {
    if (record.resourceType !== "module_workspace") continue;
    const parent = resources.get(resourceKey("module_project", record.parentProjectId));
    if (parent === undefined || parent.tenantId !== record.tenantId) invalidSnapshot();
  }

  const grantKeys = new Set<string>();
  const copiedGrants = value.grants.map((grant: unknown): LocalDeveloperMcpResourceGrant => {
    if (!exactData(grant, ["userId", "resourceType", "resourceId", "slugs"]) || !boundedString(grant.userId)
      || !validResourceType(grant.resourceType) || typeof grant.resourceId !== "string" || !opaqueIdPattern.test(grant.resourceId)
      || !Array.isArray(grant.slugs) || grant.slugs.length > ASSIGNABLE_PERMISSION_SLUGS.length
      || !grant.slugs.every((slug) => typeof slug === "string" && isAssignablePermissionSlug(slug))
      || new Set(grant.slugs).size !== grant.slugs.length
      || !resources.has(resourceKey(grant.resourceType, grant.resourceId))) invalidSnapshot();
    const key = `${grant.userId}\u0000${resourceKey(grant.resourceType, grant.resourceId)}`;
    if (grantKeys.has(key)) invalidSnapshot();
    grantKeys.add(key);
    return Object.freeze({ userId: grant.userId, resourceType: grant.resourceType, resourceId: grant.resourceId, slugs: Object.freeze([...grant.slugs]) });
  });
  const snapshot = Object.freeze({ resources: Object.freeze(copiedResources), grants: Object.freeze(copiedGrants) });

  const authorize: DeveloperMcpResourceAuthorizationAdapter["authorize"] = async (request) => {
    if (!exactData(request, ["principal", "requiredSlug", "resource"]) || !validPrincipal(request.principal)
      || typeof request.requiredSlug !== "string" || !isAssignablePermissionSlug(request.requiredSlug) || !validResource(request.resource)) return Object.freeze({ status: "denied" });
    const target = resources.get(resourceKey(request.resource.resourceType, request.resource.resourceId));
    if (target === undefined || target.tenantId !== request.principal.tenantId) return Object.freeze({ status: "denied" });
    const exact = copiedGrants.some((grant) => grant.userId === request.principal.userId
      && grant.resourceType === target.resourceType && grant.resourceId === target.resourceId && grant.slugs.includes(request.requiredSlug));
    if (exact) return Object.freeze({ status: "allowed" });
    if (target.resourceType === "module_workspace") {
      const inherited = copiedGrants.some((grant) => grant.userId === request.principal.userId
        && grant.resourceType === "module_project" && grant.resourceId === target.parentProjectId && grant.slugs.includes(request.requiredSlug));
      if (inherited) return Object.freeze({ status: "allowed" });
    }
    return Object.freeze({ status: "denied" });
  };
  return Object.freeze({ snapshot, authorize });
}
