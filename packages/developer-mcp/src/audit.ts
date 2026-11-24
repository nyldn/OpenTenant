import { createHash } from "node:crypto";

import { DEVELOPER_PROFILES, type DeveloperProfileVersion } from "./profiles";
import { type DeveloperPermissionSlug, type DeveloperRiskClass } from "./slugs";
import { DEVELOPER_TOOL_DESCRIPTORS, type DeveloperResourceType } from "./tools";

export const DEVELOPER_MCP_AUDIT_FIELDS = Object.freeze([
  "toolName", "schemaVersion", "slug", "profileVersion", "clientId", "userId",
  "tenantId", "resourceType", "resourceId", "riskClass", "authorizationDecision",
  "revocationCheckResult", "outcome", "correlationId", "priorDigest", "currentDigest",
  "contextResolution", "decisionCode",
] as const);

export type DeveloperMcpAuditField = (typeof DEVELOPER_MCP_AUDIT_FIELDS)[number];
export type DeveloperMcpAuditDecisionCode =
  | "allowed" | "invalid_context" | "unknown_tool" | "authority_missing" | "resource_denied" | "revoked";

type Common = Readonly<{
  schemaVersion: "2";
  correlationId: string;
  priorDigest: string | null;
  currentDigest: string | null;
}>;
type Unresolved = Common & Readonly<{
  contextResolution: "unresolved"; decisionCode: "invalid_context";
  toolName: null; slug: null; profileVersion: null; clientId: null; userId: null;
  tenantId: null; resourceType: null; resourceId: null; riskClass: null;
  authorizationDecision: "deny"; revocationCheckResult: "not_required"; outcome: "denied";
}>;
type Principal = Common & Readonly<{
  contextResolution: "principal"; decisionCode: "invalid_context" | "unknown_tool" | "authority_missing";
  toolName: null; slug: null; profileVersion: null; clientId: string; userId: string;
  tenantId: string; resourceType: DeveloperResourceType; resourceId: string; riskClass: null;
  authorizationDecision: "deny"; revocationCheckResult: "not_required"; outcome: "denied";
}>;
type CompleteIdentity = Common & Readonly<{
  contextResolution: "complete"; toolName: string; slug: DeveloperPermissionSlug;
  clientId: string; userId: string; tenantId: string; resourceType: DeveloperResourceType;
  resourceId: string; riskClass: DeveloperRiskClass;
}>;
type Complete = CompleteIdentity & (
  | Readonly<{ decisionCode: "allowed"; profileVersion: DeveloperProfileVersion; authorizationDecision: "allow"; revocationCheckResult: "passed"; outcome: "authorized" }>
  | Readonly<{ decisionCode: "authority_missing"; profileVersion: DeveloperProfileVersion | null; authorizationDecision: "deny"; revocationCheckResult: "not_required"; outcome: "denied" }>
  | Readonly<{ decisionCode: "resource_denied"; profileVersion: DeveloperProfileVersion; authorizationDecision: "deny"; revocationCheckResult: "passed" | "not_required"; outcome: "denied" }>
  | Readonly<{ decisionCode: "revoked"; profileVersion: DeveloperProfileVersion; authorizationDecision: "deny"; revocationCheckResult: "failed"; outcome: "denied" }>
);
export type DeveloperMcpAuditRecord = Unresolved | Principal | Complete;
export type UncommittedDeveloperMcpAuditRecord = DeveloperMcpAuditRecord & Readonly<{
  priorDigest: null;
  currentDigest: null;
}>;
export type CommittedDeveloperMcpAuditRecord = DeveloperMcpAuditRecord & Readonly<{
  priorDigest: string;
  currentDigest: string;
}>;

export interface DeveloperMcpAuditAppendAdapter {
  append(record: UncommittedDeveloperMcpAuditRecord): Promise<CommittedDeveloperMcpAuditRecord>;
}

export type InMemoryDeveloperMcpAuditAppendAdapter = DeveloperMcpAuditAppendAdapter & Readonly<{
  records: readonly CommittedDeveloperMcpAuditRecord[];
}>;

const auditFields: ReadonlySet<string> = new Set(DEVELOPER_MCP_AUDIT_FIELDS);
const toolDescriptors = new Map(DEVELOPER_TOOL_DESCRIPTORS.map((tool) => [tool.name, tool]));
const digestPattern = /^(?:genesis|(?:sha256:)?[0-9a-f]{64})$/;
const actorPattern = /^[\x20-\x7e]+$/;
const resourceIdPattern = /^[0-9a-f]{32}$/;

function evidenceString(value: unknown, field: string, maxLength = 128): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new TypeError(`Developer MCP audit ${field} is invalid`);
  }
  return value;
}
function actorString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128
    || value !== value.trim() || !actorPattern.test(value)) {
    throw new TypeError(`Developer MCP audit ${field} is invalid`);
  }
  return value;
}
function resourceType(value: unknown): DeveloperResourceType {
  if (value !== "module_project" && value !== "module_workspace") throw new TypeError("Developer MCP audit resourceType is invalid");
  return value;
}
function resourceId(value: unknown): string {
  if (typeof value !== "string" || !resourceIdPattern.test(value)) throw new TypeError("Developer MCP audit resourceId is invalid");
  return value;
}
function profile(value: unknown): DeveloperProfileVersion | null {
  if (value === null) return null;
  if (typeof value !== "string" || !Object.hasOwn(DEVELOPER_PROFILES, value)) throw new TypeError("Developer MCP audit profileVersion is invalid");
  return value as DeveloperProfileVersion;
}
function nullableDigest(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !digestPattern.test(value)) throw new TypeError(`Developer MCP audit ${field} is invalid`);
  return value;
}
function mustBeNull(input: Record<DeveloperMcpAuditField, unknown>, fields: readonly DeveloperMcpAuditField[]): void {
  if (fields.some((field) => input[field] !== null)) throw new TypeError("Developer MCP audit unresolved identity is invalid");
}

export function assertDeveloperMcpAuditRecord(value: unknown): DeveloperMcpAuditRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Developer MCP audit record must be an object");
  const keys = Reflect.ownKeys(value);
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== DEVELOPER_MCP_AUDIT_FIELDS.length
    || keys.some((key) => typeof key !== "string" || !auditFields.has(key))) {
    throw new TypeError("Developer MCP audit record has missing or unexpected fields");
  }
  const entries = DEVELOPER_MCP_AUDIT_FIELDS.map((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("Developer MCP audit fields must be enumerable data properties");
    return [field, descriptor.value] as const;
  });
  const input = Object.fromEntries(entries) as Record<DeveloperMcpAuditField, unknown>;
  if (input.schemaVersion !== "2") throw new TypeError("Developer MCP audit schemaVersion is invalid");
  const common = {
    schemaVersion: "2" as const,
    correlationId: evidenceString(input.correlationId, "correlationId"),
    priorDigest: nullableDigest(input.priorDigest, "priorDigest"),
    currentDigest: nullableDigest(input.currentDigest, "currentDigest"),
  };
  if (input.contextResolution === "unresolved") {
    mustBeNull(input, ["toolName", "slug", "profileVersion", "clientId", "userId", "tenantId", "resourceType", "resourceId", "riskClass"]);
    if (input.decisionCode !== "invalid_context" || input.authorizationDecision !== "deny"
      || input.revocationCheckResult !== "not_required" || input.outcome !== "denied") throw new TypeError("Developer MCP audit unresolved decision is invalid");
    return Object.freeze({ ...common, contextResolution: "unresolved", decisionCode: "invalid_context", toolName: null, slug: null,
      profileVersion: null, clientId: null, userId: null, tenantId: null, resourceType: null, resourceId: null, riskClass: null,
      authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied" });
  }
  if (input.contextResolution === "principal") {
    mustBeNull(input, ["toolName", "slug", "profileVersion", "riskClass"]);
    if (input.decisionCode !== "invalid_context" && input.decisionCode !== "unknown_tool" && input.decisionCode !== "authority_missing") throw new TypeError("Developer MCP audit principal decision is invalid");
    if (input.authorizationDecision !== "deny" || input.revocationCheckResult !== "not_required" || input.outcome !== "denied") throw new TypeError("Developer MCP audit principal evidence is invalid");
    return Object.freeze({ ...common, contextResolution: "principal", decisionCode: input.decisionCode, toolName: null, slug: null, profileVersion: null,
      clientId: actorString(input.clientId, "clientId"), userId: actorString(input.userId, "userId"), tenantId: actorString(input.tenantId, "tenantId"),
      resourceType: resourceType(input.resourceType), resourceId: resourceId(input.resourceId), riskClass: null,
      authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied" });
  }
  if (input.contextResolution !== "complete") throw new TypeError("Developer MCP audit contextResolution is invalid");
  const toolName = evidenceString(input.toolName, "toolName", 64);
  const descriptor = toolDescriptors.get(toolName);
  if (descriptor === undefined || input.slug !== descriptor.slug || input.riskClass !== descriptor.risk) throw new TypeError("Developer MCP audit descriptor identity is invalid");
  const requestedType = resourceType(input.resourceType);
  const matched = requestedType === descriptor.resourceType;
  const profileVersion = profile(input.profileVersion);
  const code = input.decisionCode;
  let valid = false;
  if (code === "allowed") valid = profileVersion !== null && matched && input.authorizationDecision === "allow" && input.revocationCheckResult === "passed" && input.outcome === "authorized";
  else if (code === "authority_missing") valid = input.authorizationDecision === "deny" && input.revocationCheckResult === "not_required" && input.outcome === "denied";
  else if (code === "resource_denied") valid = profileVersion !== null && input.authorizationDecision === "deny" && input.outcome === "denied"
    && ((matched && input.revocationCheckResult === "passed") || (!matched && input.revocationCheckResult === "not_required"));
  else if (code === "revoked") valid = profileVersion !== null && matched && input.authorizationDecision === "deny" && input.revocationCheckResult === "failed" && input.outcome === "denied";
  if (!valid) throw new TypeError("Developer MCP audit complete decision evidence is invalid");
  return Object.freeze({ ...common, contextResolution: "complete", decisionCode: code, toolName, slug: descriptor.slug, profileVersion,
    clientId: actorString(input.clientId, "clientId"), userId: actorString(input.userId, "userId"), tenantId: actorString(input.tenantId, "tenantId"),
    resourceType: requestedType, resourceId: resourceId(input.resourceId), riskClass: descriptor.risk,
    authorizationDecision: input.authorizationDecision, revocationCheckResult: input.revocationCheckResult, outcome: input.outcome }) as DeveloperMcpAuditRecord;
}

export function computeDeveloperMcpAuditDigest(record: DeveloperMcpAuditRecord): string {
  const validated = assertDeveloperMcpAuditRecord(record);
  const preimage = JSON.stringify(DEVELOPER_MCP_AUDIT_FIELDS
    .filter((field) => field !== "currentDigest")
    .map((field) => [field, validated[field]]));
  return `sha256:${createHash("sha256").update(preimage, "utf8").digest("hex")}`;
}

export function createInMemoryDeveloperMcpAuditAppendAdapter(): InMemoryDeveloperMcpAuditAppendAdapter {
  const committed: CommittedDeveloperMcpAuditRecord[] = [];
  let serialization: Promise<void> = Promise.resolve();
  const adapter: InMemoryDeveloperMcpAuditAppendAdapter = {
    get records() { return Object.freeze([...committed]); },
    append(record) {
      const operation = serialization.then(async () => {
        const validated = assertDeveloperMcpAuditRecord(record);
        if (validated.priorDigest !== null || validated.currentDigest !== null) {
          throw new TypeError("Developer MCP audit append requires null digest fields");
        }
        const priorDigest = committed.at(-1)?.currentDigest ?? "genesis";
        await Promise.resolve();
        const withPrior = assertDeveloperMcpAuditRecord({ ...validated, priorDigest });
        const result = assertDeveloperMcpAuditRecord({
          ...withPrior,
          currentDigest: computeDeveloperMcpAuditDigest(withPrior),
        }) as CommittedDeveloperMcpAuditRecord;
        committed.push(result);
        return result;
      });
      serialization = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
  return Object.freeze(adapter);
}
