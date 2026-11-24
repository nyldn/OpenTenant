import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "./canonical-json";

const MAX_EXPORT_RECORDS = 100;
const MAX_EXPORT_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
const GENESIS_DIGEST = `sha256:${"0".repeat(64)}`;

export type EvidenceScopeKind = "installation_owner" | "tenant";

export interface EvidenceScopeVersionInput {
  connectionId: string;
  scopeId: string;
  version: number;
  consentId: string;
  kind: EvidenceScopeKind;
  installationId: string;
  tenantIds: readonly string[];
  resourceTypes: readonly string[];
  allowedFields: readonly string[];
  purpose: string;
  region: string;
  aggregationRule: string;
  retentionDays: number;
  createdAt: string;
}

export interface EvidenceScopeVersion extends EvidenceScopeVersionInput {
  tenantIds: string[];
  resourceTypes: string[];
  allowedFields: string[];
  scopeDigest: string;
}

export interface EvidenceExportAuthorization {
  decision: "allow" | "deny";
  actorId: string;
  permission: string;
  policyVersion: string;
  reason: string;
}

export interface EvidenceExportSourceRecord {
  evidenceId: string;
  tenantId: string;
  resourceType: string;
  occurredAt: string;
  fields: Record<string, string | number | boolean | null>;
  sourceDigest: string;
}

export interface EvidenceExportRequest {
  jobId: string;
  idempotencyKey: string;
  connectionId: string;
  scopeId: string;
  scopeVersion: number;
  authorization: EvidenceExportAuthorization;
  from: string;
  to: string;
  maxRecords: number;
  records: EvidenceExportSourceRecord[];
}

export interface ExportedEvidenceRecord extends EvidenceExportSourceRecord {
  fields: Record<string, string | number | boolean | null>;
  redactedFields: string[];
}

export interface EvidenceExport {
  jobId: string;
  idempotencyKey: string;
  connectionId: string;
  scopeId: string;
  scopeVersion: number;
  scopeDigest: string;
  tenantIds: string[];
  authorization: EvidenceExportAuthorization;
  from: string;
  to: string;
  records: ExportedEvidenceRecord[];
  priorDigest: string;
  currentDigest: string;
  statement: "evidence_support_only_no_compliance_claim";
}

export interface EvidenceReconciliation {
  status: "current" | "lagging";
  exportedEvidenceIds: string[];
  missingEvidenceIds: string[];
  adapterCheckpoint: string | null;
  canonicalCheckpoint: string;
}

function digest(value: unknown): string {
  const canonical = canonicalJsonStringify(value);
  if (canonical === undefined) throw new Error("Evidence value is not serializable");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function nonEmpty(values: readonly string[], label: string): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()))].filter(Boolean).sort();
  if (normalized.length === 0) throw new Error(`${label} must be explicit and non-empty`);
  return normalized;
}

/** Creates a frozen, consent- and digest-bound scope snapshot. It never discovers tenants. */
export function createEvidenceScopeVersion(
  input: EvidenceScopeVersionInput,
): EvidenceScopeVersion {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error("Scope version must be a positive integer");
  }
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1) {
    throw new Error("Scope retention must be a positive number of days");
  }
  const tenantIds = nonEmpty(input.tenantIds, "Explicit tenant IDs");
  const resourceTypes = nonEmpty(input.resourceTypes, "Resource types");
  const allowedFields = nonEmpty(input.allowedFields, "Allowed fields");
  if (input.kind === "tenant" && (tenantIds.length !== 1 || input.aggregationRule !== "none")) {
    throw new Error("Tenant scope must select exactly one tenant and cannot aggregate");
  }
  if (input.kind === "installation_owner" && tenantIds.length === 0) {
    throw new Error("Installation-owner scope requires explicit tenant IDs");
  }
  const snapshot = {
    connectionId: input.connectionId,
    scopeId: input.scopeId,
    version: input.version,
    consentId: input.consentId,
    kind: input.kind,
    installationId: input.installationId,
    tenantIds,
    resourceTypes,
    allowedFields,
    purpose: input.purpose,
    region: input.region,
    aggregationRule: input.aggregationRule,
    retentionDays: input.retentionDays,
    createdAt: input.createdAt,
  };
  const result: EvidenceScopeVersion = {
    ...snapshot,
    tenantIds: Object.freeze(tenantIds) as unknown as string[],
    resourceTypes: Object.freeze(resourceTypes) as unknown as string[],
    allowedFields: Object.freeze(allowedFields) as unknown as string[],
    scopeDigest: digest(snapshot),
  };
  return Object.freeze(result);
}

function exportDigestValue(value: EvidenceExport): Omit<EvidenceExport, "currentDigest"> {
  const { currentDigest: _currentDigest, ...bound } = value;
  return bound;
}

export function verifyEvidenceExport(
  value: EvidenceExport,
): { intact: boolean; failure: "digest_mismatch" | null } {
  return digest(exportDigestValue(value)) === value.currentDigest
    ? { intact: true, failure: null }
    : { intact: false, failure: "digest_mismatch" };
}

/**
 * No-network conformance adapter. It models custody, delivery receipts and
 * reconciliation without a provider SDK, endpoint, credential, or compliance claim.
 */
export class SyntheticEvidenceExportAdapter {
  private readonly scopes = new Map<string, EvidenceScopeVersion>();
  private readonly revoked = new Set<string>();
  private readonly idempotency = new Map<
    string,
    { fingerprint: string; result: EvidenceExport }
  >();
  private readonly delivered = new Map<string, string[]>();
  private readonly chainHeads = new Map<string, string>();

  constructor(scopes: readonly EvidenceScopeVersion[]) {
    for (const scope of scopes) this.scopes.set(this.scopeKey(scope.scopeId, scope.version), scope);
  }

  private scopeKey(scopeId: string, version: number): string {
    return `${scopeId}:${version}`;
  }

  private requireScope(input: {
    connectionId: string;
    scopeId: string;
    scopeVersion: number;
  }): EvidenceScopeVersion {
    const key = this.scopeKey(input.scopeId, input.scopeVersion);
    const scope = this.scopes.get(key);
    if (!scope || scope.connectionId !== input.connectionId) {
      throw new Error("Evidence connection or scope is not authorized");
    }
    if (this.revoked.has(key)) throw new Error("Evidence scope version is revoked");
    return scope;
  }

  revokeScope(input: {
    scopeId: string;
    version: number;
    revokedAt: string;
    disposition: string;
  }): "revoked" | "already_revoked" {
    const key = this.scopeKey(input.scopeId, input.version);
    if (!this.scopes.has(key)) throw new Error("Unknown evidence scope version");
    if (!input.revokedAt || !input.disposition) throw new Error("Revocation disposition is required");
    if (this.revoked.has(key)) return "already_revoked";
    this.revoked.add(key);
    return "revoked";
  }

  async exportEvidence(request: EvidenceExportRequest): Promise<EvidenceExport> {
    const scope = this.requireScope(request);
    if (
      request.authorization.decision !== "allow" ||
      request.authorization.permission !== "owner.evidence.export" ||
      !request.authorization.actorId ||
      !request.authorization.policyVersion ||
      !request.authorization.reason
    ) {
      throw new Error("Explicit evidence export authorization is required");
    }
    const from = Date.parse(request.from);
    const to = Date.parse(request.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_EXPORT_WINDOW_MS) {
      throw new Error("Evidence export window exceeds the allowed bound");
    }
    if (
      !Number.isInteger(request.maxRecords) ||
      request.maxRecords < 1 ||
      request.maxRecords > MAX_EXPORT_RECORDS ||
      request.records.length > request.maxRecords
    ) {
      throw new Error("Evidence export record bound exceeded");
    }

    const fingerprint = digest({
      ...request,
      jobId: undefined,
    });
    const prior = this.idempotency.get(request.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new Error("Idempotency key was reused for different evidence");
      }
      return structuredClone(prior.result);
    }

    const allowedTenants = new Set(scope.tenantIds);
    const allowedResources = new Set(scope.resourceTypes);
    const allowedFields = new Set(scope.allowedFields);
    const records = request.records.map((record): ExportedEvidenceRecord => {
      if (!allowedTenants.has(record.tenantId)) {
        throw new Error("Evidence record crosses the authorized tenant scope");
      }
      if (!allowedResources.has(record.resourceType)) {
        throw new Error("Evidence resource type is outside the authorized scope");
      }
      const occurredAt = Date.parse(record.occurredAt);
      if (!Number.isFinite(occurredAt) || occurredAt < from || occurredAt > to) {
        throw new Error("Evidence record is outside the authorized time window");
      }
      const fields: Record<string, string | number | boolean | null> = {};
      const redactedFields: string[] = [];
      for (const key of Object.keys(record.fields).sort()) {
        if (allowedFields.has(key)) fields[key] = record.fields[key]!;
        else redactedFields.push(key);
      }
      return { ...record, fields, redactedFields };
    });

    const priorDigest = this.chainHeads.get(scope.connectionId) ?? GENESIS_DIGEST;
    const unsigned: EvidenceExport = {
      jobId: request.jobId,
      idempotencyKey: request.idempotencyKey,
      connectionId: request.connectionId,
      scopeId: request.scopeId,
      scopeVersion: request.scopeVersion,
      scopeDigest: scope.scopeDigest,
      tenantIds: [...scope.tenantIds],
      authorization: { ...request.authorization },
      from: request.from,
      to: request.to,
      records,
      priorDigest,
      currentDigest: "",
      statement: "evidence_support_only_no_compliance_claim",
    };
    const result = { ...unsigned, currentDigest: digest(exportDigestValue(unsigned)) };
    this.idempotency.set(request.idempotencyKey, { fingerprint, result: structuredClone(result) });
    this.chainHeads.set(scope.connectionId, result.currentDigest);
    const delivered = this.delivered.get(this.scopeKey(scope.scopeId, scope.version)) ?? [];
    delivered.push(...records.map((record) => record.evidenceId));
    this.delivered.set(this.scopeKey(scope.scopeId, scope.version), delivered);
    return structuredClone(result);
  }

  deliveryCount(): number {
    return this.idempotency.size;
  }

  reconcile(input: {
    connectionId: string;
    scopeId: string;
    scopeVersion: number;
    canonicalEvidenceIds: string[];
    canonicalCheckpoint: string;
  }): EvidenceReconciliation {
    const scope = this.requireScope(input);
    const exported = [
      ...new Set(this.delivered.get(this.scopeKey(scope.scopeId, scope.version)) ?? []),
    ].sort();
    const exportedSet = new Set(exported);
    const missing = [...new Set(input.canonicalEvidenceIds)]
      .filter((id) => !exportedSet.has(id))
      .sort();
    return {
      status: missing.length === 0 ? "current" : "lagging",
      exportedEvidenceIds: exported,
      missingEvidenceIds: missing,
      adapterCheckpoint: exported.at(-1) ?? null,
      canonicalCheckpoint: input.canonicalCheckpoint,
    };
  }
}
