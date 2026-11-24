import type { Pool, PoolClient } from "pg";
import type { TenantId } from "@opentenant/auth";
import type { AuditActor } from "@opentenant/security";
import {
  BRAND_DOCUMENT_MAX_KEYS,
  BRAND_POLICY_LOCK_REASON,
  isBrandTokenKey,
  validateBrandTokenValue,
  type BrandProposalStatus,
  type BrandTokens,
} from "@opentenant/platform-core";
import { PgAuditStore } from "./audit-store";

export { BRAND_POLICY_LOCK_REASON } from "@opentenant/platform-core";

export interface RejectedBrandProposalKey {
  readonly key: string;
  readonly reason: typeof BRAND_POLICY_LOCK_REASON;
}

export interface BrandProposalApplyPreview {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly policyVersion: number;
  readonly applicableKeys: readonly string[];
  readonly rejectedKeys: readonly RejectedBrandProposalKey[];
}

export interface ApplyBrandProposalInput {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly reason: string;
  readonly appliedAt: Date;
}

export interface ReviewBrandProposalInput {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly reason: string;
}

export interface RevokeBrandProposalInput {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly reason: string;
}

export interface EditBrandProposalInput {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly reason: string;
  readonly values: Readonly<Partial<BrandTokens>>;
}

export interface UploadBrandProposalInput {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly fileDigest: string;
  readonly parserVersion: string;
  readonly uploadedAt: Date;
  readonly values: Readonly<Partial<BrandTokens>>;
  readonly allowSupersede?: boolean;
}

export interface UploadedBrandProposal {
  readonly proposalId: string;
  readonly requestId: string;
  readonly duplicate: boolean;
  readonly supersededProposalId: string | null;
  readonly status: BrandProposalStatus;
}

export interface AppliedBrandProposal extends BrandProposalApplyPreview {
  readonly appliedKeys: readonly string[];
}

interface ApplyRow {
  status: string;
  reviewed_policy_version: number | null;
  policy_version: number;
  locked_keys: unknown;
  proposed_values: unknown;
}

interface EditRow {
  status: string;
  proposed_values: unknown;
}

interface ExistingUploadRow {
  request_id: string;
  proposal_id: string;
  status: BrandProposalStatus;
}

export class BrandProposalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandProposalConflictError";
  }
}

export class BrandProposalSupersedeRequiredError extends BrandProposalConflictError {
  constructor() {
    super("brand proposal supersede permission is required");
    this.name = "BrandProposalSupersedeRequiredError";
  }
}

export class BrandProposalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandProposalValidationError";
  }
}

function isLiveDraftConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const postgres = error as { code?: unknown; constraint?: unknown };
  return postgres.code === "23505"
    && postgres.constraint === "brand_proposals_one_live_draft";
}

function lockedKeys(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : []);
}

function proposedValues(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, proposed] of Object.entries(value)) {
    if (typeof proposed === "object" && proposed !== null && !Array.isArray(proposed) && "value" in proposed) {
      result[key] = (proposed as { value: unknown }).value;
    }
  }
  return result;
}

function editedProposedValues(
  current: unknown,
  edits: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    throw new BrandProposalConflictError("brand proposal values are invalid");
  }
  const entries = Object.entries(edits);
  if (entries.length === 0) throw new BrandProposalValidationError(
    "Brand proposal edit requires values",
  );
  const result = { ...current } as Record<string, unknown>;
  for (const [key, value] of entries) {
    if (!isBrandTokenKey(key)) {
      throw new BrandProposalValidationError(`Unsupported brand token key ${key}`);
    }
    const existing = result[key];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      throw new BrandProposalConflictError(`brand proposal does not contain ${key}`);
    }
    const validation = validateBrandTokenValue(key, value);
    if (!validation.ok) throw new BrandProposalValidationError(validation.reason);
    result[key] = { ...existing, value: validation.value };
  }
  return result;
}

function classify(row: ApplyRow) {
  const locked = lockedKeys(row.locked_keys);
  const values = proposedValues(row.proposed_values);
  const applicableKeys = Object.keys(values).filter((key) => !locked.has(key)).sort();
  const rejectedKeys = Object.keys(values)
    .filter((key) => locked.has(key))
    .sort()
    .map((key) => ({ key, reason: BRAND_POLICY_LOCK_REASON }));
  const applicableValues = Object.fromEntries(applicableKeys.map((key) => [key, values[key]]));
  return { applicableKeys, rejectedKeys, applicableValues };
}

function assertReviewed(row: ApplyRow | undefined): ApplyRow {
  if (!row || row.status !== "reviewed" || row.reviewed_policy_version === null) {
    throw new BrandProposalConflictError("brand proposal is not reviewed");
  }
  return row;
}

function auditActorId(actor: AuditActor): string {
  return actor.kind === "system" ? `system:${actor.job}` : actor.userId;
}

function requiredReason(value: string, operation: string): string {
  const reason = value.trim();
  if (reason.length === 0 || reason.length > 1000) {
    throw new TypeError(`Brand proposal ${operation} requires a reason`);
  }
  return reason;
}

function assertDate(value: Date, operation: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`Brand proposal ${operation} requires a valid time`);
  }
}

function uploadActorId(actor: AuditActor): string {
  if (actor.kind === "system") {
    throw new BrandProposalValidationError("Brand proposal upload requires a user actor");
  }
  const userId = actor.userId;
  if (userId !== userId.trim() || userId.length === 0 || userId.length > 255) {
    throw new BrandProposalValidationError("Brand proposal upload requires a valid user actor");
  }
  return userId;
}

function storedUploadValues(
  values: Readonly<Partial<BrandTokens>>,
  provenance: {
    readonly fileDigest: string;
    readonly uploadedByUserId: string;
    readonly uploadedAt: Date;
  },
): Record<string, unknown> {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0 || entries.length > BRAND_DOCUMENT_MAX_KEYS) {
    throw new BrandProposalValidationError(
      `Brand proposal upload requires 1 to ${BRAND_DOCUMENT_MAX_KEYS} values`,
    );
  }
  return Object.fromEntries(entries.map(([key, value]) => {
    if (!isBrandTokenKey(key)) {
      throw new BrandProposalValidationError(`Unsupported brand token key ${key}`);
    }
    const validation = validateBrandTokenValue(key, value);
    if (!validation.ok) throw new BrandProposalValidationError(validation.reason);
    return [key, {
      value: validation.value,
      fileDigest: provenance.fileDigest,
      uploadedByUserId: provenance.uploadedByUserId,
      uploadedAt: provenance.uploadedAt.toISOString(),
    }];
  }));
}

/** PostgreSQL composition boundary for previewing and atomically applying reviewed brand proposals. */
export class PgBrandProposalStore {
  private readonly audit: PgAuditStore;

  constructor(private readonly pool: Pool) {
    this.audit = new PgAuditStore(pool);
  }

  async upload(input: UploadBrandProposalInput): Promise<UploadedBrandProposal> {
    assertDate(input.uploadedAt, "upload");
    if (!/^[0-9a-f]{64}$/u.test(input.fileDigest)) {
      throw new BrandProposalValidationError("Brand proposal upload requires a SHA-256 digest");
    }
    if (!/^[a-z][a-z0-9-]{2,63}$/u.test(input.parserVersion)) {
      throw new BrandProposalValidationError("Brand proposal upload requires a parser version");
    }
    const uploadedByUserId = uploadActorId(input.actor);
    const values = storedUploadValues(input.values, {
      fileDigest: input.fileDigest,
      uploadedByUserId,
      uploadedAt: input.uploadedAt,
    });
    const source = `upload:${input.fileDigest}`;

    try {
      return await this.transaction(async (client) => {
        const tenant = await client.query<{ tenant_id: string }>(
          `select tenant.tenant_id
             from tenants tenant
             join brand_policies policy on policy.tenant_id = tenant.tenant_id
            where tenant.tenant_id = $1
            for update of tenant`,
          [input.tenantId],
        );
        if (tenant.rowCount !== 1) {
          throw new BrandProposalConflictError("brand proposal tenant was not found");
        }

        const existing = await client.query<ExistingUploadRow>(
          `select request.request_id, proposal.proposal_id, proposal.status
             from brand_seed_requests request
             join brand_proposals proposal
               on proposal.request_id = request.request_id
              and proposal.tenant_id = request.tenant_id
            where request.tenant_id = $1
              and request.origin = 'upload'
              and request.source_url = $2
              and request.status <> 'discarded'
            limit 1`,
          [input.tenantId, source],
        );
        const duplicate = existing.rows[0];
        if (duplicate) {
          return {
            proposalId: duplicate.proposal_id,
            requestId: duplicate.request_id,
            duplicate: true,
            supersededProposalId: null,
            status: duplicate.status,
          };
        }

        const liveDraft = await client.query<{ proposal_id: string }>(
          `select proposal_id
             from brand_proposals
            where tenant_id = $1 and status = 'draft'
            for update`,
          [input.tenantId],
        );
        if (liveDraft.rowCount !== 0 && liveDraft.rowCount !== 1) {
          throw new BrandProposalConflictError("brand proposal draft state is invalid");
        }
        if (liveDraft.rowCount === 1 && input.allowSupersede !== true) {
          throw new BrandProposalSupersedeRequiredError();
        }

        const superseded = await client.query<{ proposal_id: string }>(
          `update brand_proposals
              set status = 'superseded', superseded_at = $2
            where tenant_id = $1 and status = 'draft' and $3::boolean
          returning proposal_id`,
          [input.tenantId, input.uploadedAt, input.allowSupersede === true],
        );
        if (superseded.rowCount !== 0 && superseded.rowCount !== 1) {
          throw new BrandProposalConflictError("brand proposal draft state is invalid");
        }
        const supersededProposalId = superseded.rows[0]?.proposal_id ?? null;

        const request = await client.query<{ request_id: string }>(
          `insert into brand_seed_requests
             (tenant_id, source_url, origin, status, created_at, updated_at)
           values ($1, $2, 'upload', 'completed', $3, $3)
           returning request_id`,
          [input.tenantId, source, input.uploadedAt],
        );
        const requestId = request.rows[0]?.request_id;
        if (request.rowCount !== 1 || !requestId) {
          throw new BrandProposalConflictError("brand upload request was not persisted");
        }
        const proposal = await client.query<{ proposal_id: string }>(
          `insert into brand_proposals
             (request_id, tenant_id, proposed_values, parser_version, created_at)
           values ($1, $2, $3::jsonb, $4, $5)
           returning proposal_id`,
          [
            requestId,
            input.tenantId,
            JSON.stringify(values),
            input.parserVersion,
            input.uploadedAt,
          ],
        );
        const proposalId = proposal.rows[0]?.proposal_id;
        if (proposal.rowCount !== 1 || !proposalId) {
          throw new BrandProposalConflictError("brand upload proposal was not persisted");
        }
        await this.audit.appendWithClient(client, {
          occurredAt: input.uploadedAt,
          actor: input.actor,
          tenantId: input.tenantId,
          action: "brand.proposal.uploaded",
          subject: proposalId,
          detail: {
            fileDigest: input.fileDigest,
            parserVersion: input.parserVersion,
            valueKeys: Object.keys(values).join(","),
            supersededProposalId,
          },
        });
        return {
          proposalId,
          requestId,
          duplicate: false,
          supersededProposalId,
          status: "draft",
        };
      });
    } catch (error) {
      if (isLiveDraftConflict(error)) {
        throw new BrandProposalConflictError("brand proposal upload raced another draft");
      }
      throw error;
    }
  }

  async preview(proposalId: string, tenantId: TenantId): Promise<BrandProposalApplyPreview> {
    const { rows } = await this.pool.query<ApplyRow>(
      `select proposal.status, proposal.reviewed_policy_version,
              proposal.proposed_values, policy.version as policy_version,
              policy.locked_keys
         from brand_proposals proposal
         join brand_policies policy on policy.tenant_id = proposal.tenant_id
        where proposal.proposal_id = $1 and proposal.tenant_id = $2`,
      [proposalId, tenantId],
    );
    const row = assertReviewed(rows[0]);
    if (row.reviewed_policy_version !== row.policy_version) {
      throw new BrandProposalConflictError("brand policy version changed after review");
    }
    const classified = classify(row);
    return {
      proposalId,
      tenantId,
      policyVersion: row.policy_version,
      applicableKeys: classified.applicableKeys,
      rejectedKeys: classified.rejectedKeys,
    };
  }

  async review(input: ReviewBrandProposalInput): Promise<void> {
    const reason = requiredReason(input.reason, "review");
    await this.transaction(async (client) => {
      const reviewed = await client.query<{ reviewed_at: Date }>(
        `update brand_proposals proposal
            set status = 'reviewed', reviewed_at = now(), discarded_at = null,
                reviewed_policy_version = policy.version
           from brand_policies policy
          where proposal.proposal_id = $1
            and proposal.tenant_id = $2
            and policy.tenant_id = proposal.tenant_id
            and proposal.status = 'draft'
            and proposal.proposed_values <> '{}'::jsonb
        returning proposal.reviewed_at`,
        [input.proposalId, input.tenantId],
      );
      const reviewedAt = reviewed.rows[0]?.reviewed_at;
      if (reviewed.rowCount !== 1 || !(reviewedAt instanceof Date)) {
        throw new BrandProposalConflictError("brand proposal review rejected");
      }
      await this.audit.appendWithClient(client, {
        occurredAt: reviewedAt,
        actor: input.actor,
        tenantId: input.tenantId,
        action: "brand.proposal.reviewed",
        subject: input.proposalId,
        detail: { reason },
      });
    });
  }

  async revoke(input: RevokeBrandProposalInput): Promise<void> {
    const reason = requiredReason(input.reason, "revoke");
    await this.transaction(async (client) => {
      const revoked = await client.query<{ request_id: string; discarded_at: Date }>(
        `update brand_proposals
            set status = 'discarded', discarded_at = now()
          where proposal_id = $1
            and tenant_id = $2
            and status in ('draft', 'reviewed')
        returning request_id, discarded_at`,
        [input.proposalId, input.tenantId],
      );
      const requestId = revoked.rows[0]?.request_id;
      const revokedAt = revoked.rows[0]?.discarded_at;
      if (revoked.rowCount !== 1 || !requestId || !(revokedAt instanceof Date)) {
        throw new BrandProposalConflictError("brand proposal revoke rejected");
      }
      const cancelled = await client.query(
        `update brand_seed_requests
            set status = 'discarded', updated_at = $3
          where request_id = $1 and tenant_id = $2`,
        [requestId, input.tenantId, revokedAt],
      );
      if (cancelled.rowCount !== 1) {
        throw new BrandProposalConflictError("brand proposal source revoke rejected");
      }
      // The existing discard event is the canonical evidence name; revoke is the permission verb.
      await this.audit.appendWithClient(client, {
        occurredAt: revokedAt,
        actor: input.actor,
        tenantId: input.tenantId,
        action: "brand.proposal.discarded",
        subject: input.proposalId,
        detail: { reason },
      });
    });
  }

  async edit(input: EditBrandProposalInput): Promise<void> {
    const reason = requiredReason(input.reason, "edit");
    try {
      await this.transaction(async (client) => {
        const selected = await client.query<EditRow>(
          `select status, proposed_values
             from brand_proposals
            where proposal_id = $1 and tenant_id = $2
            for update`,
          [input.proposalId, input.tenantId],
        );
        const row = selected.rows[0];
        if (!row || (row.status !== "draft" && row.status !== "reviewed")) {
          throw new BrandProposalConflictError("brand proposal edit rejected");
        }
        const proposedValues = editedProposedValues(
          row.proposed_values,
          input.values as Readonly<Record<string, unknown>>,
        );
        const edited = await client.query<{ edited_at: Date }>(
          `update brand_proposals
              set proposed_values = $3::jsonb, status = 'draft',
                  reviewed_at = null, reviewed_policy_version = null
            where proposal_id = $1 and tenant_id = $2
              and status in ('draft', 'reviewed')
              and proposed_values is distinct from $3::jsonb
          returning clock_timestamp() as edited_at`,
          [input.proposalId, input.tenantId, JSON.stringify(proposedValues)],
        );
        const editedAt = edited.rows[0]?.edited_at;
        if (edited.rowCount === 0) {
          throw new BrandProposalValidationError(
            "Brand proposal edit requires changed values",
          );
        }
        if (edited.rowCount !== 1 || !(editedAt instanceof Date)) {
          throw new BrandProposalConflictError("brand proposal edit rejected");
        }
        await this.audit.appendWithClient(client, {
          occurredAt: editedAt,
          actor: input.actor,
          tenantId: input.tenantId,
          action: "brand.proposal.edited",
          subject: input.proposalId,
          detail: { reason },
        });
      });
    } catch (error) {
      if (isLiveDraftConflict(error)) {
        throw new BrandProposalConflictError(
          "discard the existing draft before editing this reviewed proposal",
        );
      }
      throw error;
    }
  }

  async apply(input: ApplyBrandProposalInput): Promise<AppliedBrandProposal> {
    const reason = requiredReason(input.reason, "apply");
    assertDate(input.appliedAt, "apply");
    return this.transaction(async (client) => {
      const { rows } = await client.query<ApplyRow>(
        `select proposal.status, proposal.reviewed_policy_version,
                proposal.proposed_values, policy.version as policy_version,
                policy.locked_keys
           from brand_proposals proposal
           join brand_policies policy on policy.tenant_id = proposal.tenant_id
          where proposal.proposal_id = $1 and proposal.tenant_id = $2
          for update of proposal, policy`,
        [input.proposalId, input.tenantId],
      );
      const row = assertReviewed(rows[0]);
      if (row.reviewed_policy_version !== row.policy_version) {
        throw new BrandProposalConflictError("brand policy version changed after review");
      }
      const classified = classify(row);
      const policy = await client.query<{ version: number }>(
        `update brand_policies
            set overrides = overrides || $2::jsonb,
                version = version + 1,
                updated_at = $4
          where tenant_id = $1 and version = $3
        returning version`,
        [
          input.tenantId,
          JSON.stringify(classified.applicableValues),
          row.policy_version,
          input.appliedAt,
        ],
      );
      const policyVersion = policy.rows[0]?.version;
      if (!policyVersion) throw new BrandProposalConflictError("brand policy version changed after review");
      const proposal = await client.query(
        `update brand_proposals
            -- reviewed_at comes from the database clock at microsecond
            -- precision; a caller's millisecond Date can trail it.
            set status = 'applied', applied_at = greatest($3::timestamptz, reviewed_at), applied_by = $4
          where proposal_id = $1 and tenant_id = $2 and status = 'reviewed'
        returning proposal_id`,
        [input.proposalId, input.tenantId, input.appliedAt, auditActorId(input.actor)],
      );
      if (proposal.rowCount !== 1) throw new BrandProposalConflictError("brand proposal is not reviewed");
      await this.audit.appendWithClient(client, {
        occurredAt: input.appliedAt,
        actor: input.actor,
        tenantId: input.tenantId,
        action: "brand.proposal.applied",
        subject: input.proposalId,
        detail: {
          reason,
          policyVersion,
          appliedKeys: JSON.stringify(classified.applicableKeys),
          rejectedKeys: JSON.stringify(classified.rejectedKeys),
        },
      });
      return {
        proposalId: input.proposalId,
        tenantId: input.tenantId,
        policyVersion,
        applicableKeys: classified.applicableKeys,
        appliedKeys: classified.applicableKeys,
        rejectedKeys: classified.rejectedKeys,
      };
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
