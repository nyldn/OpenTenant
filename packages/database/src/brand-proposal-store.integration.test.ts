import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { TenantId } from "@opentenant/auth";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { PgBrandProposalStore } from "./brand-proposal-store";

const integrationUrl = integrationDatabaseUrl("CONTROL_PLANE_INTEGRATION_DATABASE_URL");
const describeIntegration = integrationUrl ? describe : describe.skip;
const fixtureRunId = randomUUID().slice(0, 8);
const raceTenantId = `ten_brand_apply_race_${fixtureRunId}` as TenantId;
const driftTenantId = `ten_brand_apply_drift_${fixtureRunId}` as TenantId;
const clockTenantId = `ten_brand_apply_clock_${fixtureRunId}` as TenantId;
const boundTenantId = `ten_brand_perm_bound_${fixtureRunId}` as TenantId;
const submittedTenantId = `ten_brand_perm_submitted_${fixtureRunId}` as TenantId;
const reviewTenantId = `ten_brand_review_${fixtureRunId}` as TenantId;
const revokeTenantId = `ten_brand_revoke_${fixtureRunId}` as TenantId;
const editConflictTenantId = `ten_brand_edit_conflict_${fixtureRunId}` as TenantId;
const editOnlyTenantId = `ten_brand_edit_only_${fixtureRunId}` as TenantId;
const editTenantId = `ten_brand_edit_${fixtureRunId}` as TenantId;
const unrelatedTenantId = `ten_brand_apply_unrelated_${fixtureRunId}` as TenantId;
const uploadDuplicateTenantId = `ten_brand_upload_dup_${fixtureRunId}` as TenantId;
const uploadSupersedeTenantId = `ten_brand_upload_super_${fixtureRunId}` as TenantId;
const uploadRollbackTenantId = `ten_brand_upload_rollback_${fixtureRunId}` as TenantId;

describeIntegration("brand proposal apply against PostgreSQL", () => {
  if (!integrationUrl) return;
  const pool = new Pool({ connectionString: integrationUrl, max: 4 });

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ($1, $2, 'Unrelated Brand Apply Fixture', 'active', 'eu')`,
      [unrelatedTenantId, `brand-apply-unrelated-${fixtureRunId}`],
    );
    await pool.query(
      `insert into tenant_modules (tenant_id, module_key, module_version)
       values ($1, 'assessment', '1.0.0')`,
      [unrelatedTenantId],
    );
  });

  async function createBrandFixture(tenantId: TenantId, slug: string): Promise<void> {
    await pool.query(
      `insert into tenants (tenant_id, slug, display_name, status, data_region)
       values ($1, $2, 'Brand Apply', 'active', 'eu')`,
      [tenantId, slug],
    );
    await pool.query(
      `insert into brand_policies
        (tenant_id, defaults, locked_keys, overrides, version, updated_at)
       values ($1, '{}', '["logoUrl"]', '{"supportEmail":"old@example.test"}', 4, now())`,
      [tenantId],
    );
  }

  afterAll(async () => {
    await pool.query("delete from tenant_modules where tenant_id = $1", [unrelatedTenantId]);
    await pool.query("delete from tenants where tenant_id = $1", [unrelatedTenantId]);
    await pool.end();
  });

  async function reviewedProposal(tenantId: TenantId): Promise<string> {
    const request = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url)
       values ($1, 'https://brand.example.test') returning request_id`,
      [tenantId],
    );
    const proposal = await pool.query<{ proposal_id: string }>(
      `insert into brand_proposals
        (request_id, tenant_id, status, proposed_values, reviewed_at, reviewed_policy_version)
       values ($1, $2, 'reviewed', $3::jsonb, now(), 4) returning proposal_id`,
      [
        request.rows[0]!.request_id,
        tenantId,
        JSON.stringify({
          displayName: {
            value: "Example Organisation",
            sourceUrl: "https://brand.example.test",
            retrievedAt: "2026-07-29T09:00:00Z",
          },
          logoUrl: {
            value: "https://cdn.example.test/logo.svg",
            sourceUrl: "https://brand.example.test",
            retrievedAt: "2026-07-29T09:00:00Z",
          },
          colorPrimary: {
            value: "#123456",
            sourceUrl: "https://brand.example.test",
            retrievedAt: "2026-07-29T09:00:00Z",
          },
        }),
      ],
    );
    return proposal.rows[0]!.proposal_id;
  }

  async function draftProposal(tenantId: TenantId): Promise<string> {
    const request = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url)
       values ($1, 'https://draft-brand.example.test') returning request_id`,
      [tenantId],
    );
    const proposal = await pool.query<{ proposal_id: string }>(
      `insert into brand_proposals (request_id, tenant_id, proposed_values)
       values ($1, $2, $3::jsonb) returning proposal_id`,
      [
        request.rows[0]!.request_id,
        tenantId,
        JSON.stringify({
          displayName: {
            value: "Draft Organisation",
            sourceUrl: "https://draft-brand.example.test",
            retrievedAt: "2026-07-30T09:00:00Z",
          },
        }),
      ],
    );
    return proposal.rows[0]!.proposal_id;
  }

  it("reviews and revokes with database timestamps and one canonical audit per transition", async () => {
    await createBrandFixture(reviewTenantId, `brand-review-${fixtureRunId}`);
    await createBrandFixture(revokeTenantId, `brand-revoke-${fixtureRunId}`);
    const revokeProposalId = await draftProposal(revokeTenantId);
    const store = new PgBrandProposalStore(pool);
    const uploadedAt = new Date("2026-09-06T15:00:00.000Z");
    const digest = "e".repeat(64);
    const uploaded = await store.upload({
      tenantId: reviewTenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      fileDigest: digest,
      parserVersion: "brand-md-v1",
      uploadedAt,
      values: {
        displayName: "Uploaded Organisation",
        logoUrl: "https://cdn.example.test/uploaded-logo.svg",
      },
    });
    const reviewProposalId = uploaded.proposalId;

    await store.review({
      proposalId: reviewProposalId,
      tenantId: reviewTenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      reason: "Values checked against source evidence",
    });
    await store.revoke({
      proposalId: revokeProposalId,
      tenantId: revokeTenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      reason: "Proposal no longer represents the tenant",
    });

    const reviewed = await pool.query<{
      status: string;
      created_at: Date;
      reviewed_at: Date;
      reviewed_policy_version: number;
    }>(
      `select status, created_at, reviewed_at, reviewed_policy_version
         from brand_proposals where proposal_id = $1`,
      [reviewProposalId],
    );
    expect(reviewed.rows[0]).toMatchObject({
      status: "reviewed",
      reviewed_policy_version: 4,
    });
    expect(reviewed.rows[0]!.reviewed_at.getTime()).toBeGreaterThanOrEqual(
      reviewed.rows[0]!.created_at.getTime(),
    );
    const uploadEvidence = await pool.query<{
      origin: string;
      source_url: string;
      request_status: string;
      parser_version: string;
      proposed_values: Record<string, Record<string, unknown>>;
    }>(
      `select request.origin, request.source_url, request.status as request_status,
              proposal.parser_version, proposal.proposed_values
         from brand_seed_requests request
         join brand_proposals proposal
           on proposal.request_id = request.request_id
          and proposal.tenant_id = request.tenant_id
        where request.tenant_id = $1 and proposal.proposal_id = $2`,
      [reviewTenantId, reviewProposalId],
    );
    expect(uploadEvidence.rows).toEqual([expect.objectContaining({
      origin: "upload",
      source_url: `upload:${digest}`,
      request_status: "completed",
      parser_version: "brand-md-v1",
    })]);
    expect(uploadEvidence.rows[0]!.proposed_values.displayName).toEqual({
      value: "Uploaded Organisation",
      fileDigest: digest,
      uploadedByUserId: "usr_tenant_admin",
      uploadedAt: uploadedAt.toISOString(),
    });
    expect((await pool.query(
      `select 1 from audit_events
        where tenant_id = $1 and action = 'brand.proposal.uploaded' and subject = $2`,
      [reviewTenantId, reviewProposalId],
    )).rows).toHaveLength(1);

    const revoked = await pool.query<{
      proposal_status: string;
      request_status: string;
      created_at: Date;
      discarded_at: Date;
    }>(
      `select proposal.status as proposal_status, request.status as request_status,
              proposal.created_at, proposal.discarded_at
         from brand_proposals proposal
         join brand_seed_requests request
           on request.request_id = proposal.request_id and request.tenant_id = proposal.tenant_id
        where proposal.proposal_id = $1`,
      [revokeProposalId],
    );
    expect(revoked.rows[0]).toMatchObject({
      proposal_status: "discarded",
      request_status: "discarded",
    });
    expect(revoked.rows[0]!.discarded_at.getTime()).toBeGreaterThanOrEqual(
      revoked.rows[0]!.created_at.getTime(),
    );

    for (const [tenantId, action, proposalId, reason] of [
      [reviewTenantId, "brand.proposal.reviewed", reviewProposalId, "Values checked against source evidence"],
      [revokeTenantId, "brand.proposal.discarded", revokeProposalId, "Proposal no longer represents the tenant"],
    ] as const) {
      const audit = await pool.query<{ actor: { userId: string }; detail: { reason: string } }>(
        `select actor, detail from audit_events
          where tenant_id = $1 and action = $2 and subject = $3`,
        [tenantId, action, proposalId],
      );
      expect(audit.rows).toEqual([{
        actor: { kind: "user", userId: "usr_tenant_admin" },
        detail: { reason },
      }]);
    }
  });

  it("deduplicates concurrent uploads of the same digest across real connections", async () => {
    await createBrandFixture(
      uploadDuplicateTenantId,
      `brand-upload-duplicate-${fixtureRunId}`,
    );
    const duplicateDigest = "f".repeat(64);
    const upload = () => new PgBrandProposalStore(pool).upload({
      tenantId: uploadDuplicateTenantId,
      actor: { kind: "user", userId: "usr_uploader" },
      fileDigest: duplicateDigest,
      parserVersion: "brand-md-v1",
      uploadedAt: new Date("2026-09-06T16:00:00.000Z"),
      values: { displayName: "Duplicate Race" },
    });

    const uploadResults = await Promise.all([upload(), upload()]);

    expect(uploadResults.filter((result) => result.duplicate)).toHaveLength(1);
    expect(uploadResults.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(new Set(uploadResults.map((result) => result.proposalId)).size).toBe(1);
    expect((await pool.query(
      "select 1 from brand_proposals where tenant_id = $1",
      [uploadDuplicateTenantId],
    )).rows).toHaveLength(1);
    expect((await pool.query(
      `select 1 from audit_events
        where tenant_id = $1 and action = 'brand.proposal.uploaded'`,
      [uploadDuplicateTenantId],
    )).rows).toHaveLength(1);
  });

  it("supersedes only the prior draft when a different digest is uploaded", async () => {
    await createBrandFixture(
      uploadSupersedeTenantId,
      `brand-upload-supersede-${fixtureRunId}`,
    );
    const store = new PgBrandProposalStore(pool);
    const first = await store.upload({
      tenantId: uploadSupersedeTenantId,
      actor: { kind: "user", userId: "usr_uploader" },
      fileDigest: "1".repeat(64),
      parserVersion: "brand-md-v1",
      uploadedAt: new Date("2026-09-06T16:01:00.000Z"),
      values: { displayName: "First Draft" },
    });
    const second = await store.upload({
      tenantId: uploadSupersedeTenantId,
      actor: { kind: "user", userId: "usr_uploader" },
      fileDigest: "2".repeat(64),
      parserVersion: "brand-md-v1",
      uploadedAt: new Date("2026-09-06T16:02:00.000Z"),
      values: { displayName: "Second Draft" },
      allowSupersede: true,
    });

    expect(second.supersededProposalId).toBe(first.proposalId);
    expect((await pool.query<{ proposal_id: string; status: string }>(
      "select proposal_id, status from brand_proposals where tenant_id = $1 order by created_at",
      [uploadSupersedeTenantId],
    )).rows).toEqual([
      { proposal_id: first.proposalId, status: "superseded" },
      { proposal_id: second.proposalId, status: "draft" },
    ]);
  });

  it("keeps the current draft when upload lacks supersede authority", async () => {
    const tenantId = `brand_no_supersede_${fixtureRunId}` as TenantId;
    await createBrandFixture(tenantId, `brand-no-supersede-${fixtureRunId}`);
    const store = new PgBrandProposalStore(pool);
    const first = await store.upload({
      tenantId,
      actor: { kind: "user", userId: "usr_uploader" },
      fileDigest: "6".repeat(64),
      parserVersion: "brand-md-v1",
      uploadedAt: new Date("2026-09-06T16:02:10.000Z"),
      values: { displayName: "Current Draft" },
    });

    await expect(store.upload({
      tenantId,
      actor: { kind: "user", userId: "usr_uploader" },
      fileDigest: "7".repeat(64),
      parserVersion: "brand-md-v1",
      uploadedAt: new Date("2026-09-06T16:02:20.000Z"),
      values: { displayName: "Unauthorized Replacement" },
      allowSupersede: false,
    })).rejects.toThrow("brand proposal supersede permission is required");

    expect((await pool.query<{ proposal_id: string; status: string }>(
      "select proposal_id, status from brand_proposals where tenant_id = $1 order by created_at",
      [tenantId],
    )).rows).toEqual([{ proposal_id: first.proposalId, status: "draft" }]);
    expect((await pool.query(
      `select 1 from audit_events
        where tenant_id = $1 and action = 'brand.proposal.uploaded'`,
      [tenantId],
    )).rows).toHaveLength(1);
  });

  it("rolls back request and proposal creation when upload audit persistence fails", async () => {
    await createBrandFixture(
      uploadRollbackTenantId,
      `brand-upload-rollback-${fixtureRunId}`,
    );
    await pool.query(`
      create function reject_test_upload_audit() returns trigger
      language plpgsql as $$
      begin
        if new.action = 'brand.proposal.uploaded' then
          raise exception 'synthetic audit failure';
        end if;
        return new;
      end;
      $$;
      create trigger reject_test_upload_audit
        before insert on audit_events
        for each row execute function reject_test_upload_audit();
    `);
    try {
      await expect(new PgBrandProposalStore(pool).upload({
        tenantId: uploadRollbackTenantId,
        actor: { kind: "user", userId: "usr_uploader" },
        fileDigest: "3".repeat(64),
        parserVersion: "brand-md-v1",
        uploadedAt: new Date("2026-09-06T16:03:00.000Z"),
        values: { displayName: "Must Roll Back" },
      })).rejects.toThrow("synthetic audit failure");
    } finally {
      await pool.query("drop trigger reject_test_upload_audit on audit_events");
      await pool.query("drop function reject_test_upload_audit() cascade");
    }
    expect((await pool.query(
      "select 1 from brand_seed_requests where tenant_id = $1",
      [uploadRollbackTenantId],
    )).rows).toHaveLength(0);
    expect((await pool.query(
      "select 1 from brand_proposals where tenant_id = $1",
      [uploadRollbackTenantId],
    )).rows).toHaveLength(0);
  });

  it("allows exactly one of two real connections to apply the same review", async () => {
    await createBrandFixture(raceTenantId, `brand-apply-race-${fixtureRunId}`);
    const proposalId = await reviewedProposal(raceTenantId);
    const appliedAt = new Date();
    const apply = () => new PgBrandProposalStore(pool).apply({
      proposalId,
      tenantId: raceTenantId,
      actor: { kind: "installation_owner", userId: "usr_owner" },
      reason: "Reviewed brand evidence",
      appliedAt,
    });

    const results = await Promise.allSettled([apply(), apply()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const policy = await pool.query<{ overrides: Record<string, unknown>; version: number }>(
      "select overrides, version from brand_policies where tenant_id = $1",
      [raceTenantId],
    );
    expect(policy.rows[0]).toEqual({
      overrides: {
        colorPrimary: "#123456",
        displayName: "Example Organisation",
        supportEmail: "old@example.test",
      },
      version: 5,
    });
    const audit = await pool.query<{ detail: Record<string, unknown> }>(
      "select detail from audit_events where tenant_id = $1 and action = 'brand.proposal.applied'",
      [raceTenantId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.detail).toEqual(expect.objectContaining({
      reason: "Reviewed brand evidence",
      policyVersion: 5,
    }));
    expect((await pool.query(
      "select 1 from tenant_modules where tenant_id = $1 and module_key = 'assessment'",
      [unrelatedTenantId],
    )).rows).toHaveLength(1);
  });

  it("applies when the caller's clock trails the database review time", async () => {
    await createBrandFixture(clockTenantId, `brand-apply-clock-${fixtureRunId}`);
    const proposalId = await reviewedProposal(clockTenantId);
    // reviewed_at is database now(); a millisecond or skewed app Date can trail it.
    await new PgBrandProposalStore(pool).apply({
      proposalId,
      tenantId: clockTenantId,
      actor: { kind: "installation_owner", userId: "usr_owner" },
      reason: "Reviewed brand evidence",
      appliedAt: new Date(Date.now() - 60_000),
    });
    const { rows } = await pool.query<{ ordered: boolean }>(
      "select applied_at >= reviewed_at as ordered from brand_proposals where proposal_id = $1",
      [proposalId],
    );
    expect(rows[0]?.ordered).toBe(true);
  });

  it("rejects version drift without clobbering newer policy state", async () => {
    await createBrandFixture(driftTenantId, `brand-apply-drift-${fixtureRunId}`);
    const proposalId = await reviewedProposal(driftTenantId);
    await pool.query(
      `update brand_policies
          set overrides = overrides || '{"displayName":"Newer manual value"}',
              version = version + 1
        where tenant_id = $1`,
      [driftTenantId],
    );

    await expect(new PgBrandProposalStore(pool).apply({
      proposalId,
      tenantId: driftTenantId,
      actor: { kind: "installation_owner", userId: "usr_owner" },
      reason: "Stale review",
      appliedAt: new Date("2026-07-29T10:00:00Z"),
    })).rejects.toThrow("policy version changed after review");

    const policy = await pool.query<{ overrides: Record<string, unknown>; version: number }>(
      "select overrides, version from brand_policies where tenant_id = $1",
      [driftTenantId],
    );
    expect(policy.rows[0]).toEqual({
      overrides: {
        displayName: "Newer manual value",
        supportEmail: "old@example.test",
      },
      version: 5,
    });
    expect((await pool.query(
      "select 1 from audit_events where tenant_id = $1 and action = 'brand.proposal.applied'",
      [driftTenantId],
    )).rows).toHaveLength(0);
    expect((await pool.query(
      "select 1 from tenant_modules where tenant_id = $1 and module_key = 'assessment'",
      [unrelatedTenantId],
    )).rows).toHaveLength(1);
  });

  it("changes no proposal, policy, or audit row for a cross-tenant transition", async () => {
    await createBrandFixture(boundTenantId, `brand-perm-bound-${fixtureRunId}`);
    await createBrandFixture(submittedTenantId, `brand-perm-submitted-${fixtureRunId}`);
    const proposalId = await reviewedProposal(boundTenantId);
    const beforeProposal = await pool.query(
      "select status, reviewed_at, applied_at, discarded_at from brand_proposals where proposal_id = $1",
      [proposalId],
    );
    const beforePolicies = await pool.query(
      "select tenant_id, overrides, version from brand_policies where tenant_id = any($1) order by tenant_id",
      [[boundTenantId, submittedTenantId]],
    );
    const beforeAudits = await pool.query<{ count: string }>(
      "select count(*)::text as count from audit_events where tenant_id = any($1)",
      [[boundTenantId, submittedTenantId]],
    );

    await expect(new PgBrandProposalStore(pool).apply({
      proposalId,
      tenantId: submittedTenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      reason: "Cross-tenant request must fail",
      appliedAt: new Date("2026-07-30T10:00:00Z"),
    })).rejects.toThrow("brand proposal is not reviewed");

    expect((await pool.query(
      "select status, reviewed_at, applied_at, discarded_at from brand_proposals where proposal_id = $1",
      [proposalId],
    )).rows).toEqual(beforeProposal.rows);
    expect((await pool.query(
      "select tenant_id, overrides, version from brand_policies where tenant_id = any($1) order by tenant_id",
      [[boundTenantId, submittedTenantId]],
    )).rows).toEqual(beforePolicies.rows);
    expect((await pool.query<{ count: string }>(
      "select count(*)::text as count from audit_events where tenant_id = any($1)",
      [[boundTenantId, submittedTenantId]],
    )).rows).toEqual(beforeAudits.rows);
  });

  it("reports the existing live draft when editing a reviewed proposal", async () => {
    await createBrandFixture(editConflictTenantId, `brand-edit-conflict-${fixtureRunId}`);
    const reviewedId = await reviewedProposal(editConflictTenantId);
    await draftProposal(editConflictTenantId);

    await expect(new PgBrandProposalStore(pool).edit({
      proposalId: reviewedId,
      tenantId: editConflictTenantId,
      actor: { kind: "user", userId: "usr_editor" },
      reason: "Correct tenant display name",
      values: { displayName: "After" },
    })).rejects.toThrow("discard the existing draft");

    expect((await pool.query<{ status: string }>(
      "select status from brand_proposals where proposal_id = $1",
      [reviewedId],
    )).rows).toEqual([{ status: "reviewed" }]);
    expect((await pool.query(
      `select 1 from audit_events
        where tenant_id = $1 and action = 'brand.proposal.edited'`,
      [editConflictTenantId],
    )).rows).toHaveLength(0);
  });

  it("edits once with preserved provenance, cleared review, and one canonical audit", async () => {
    await createBrandFixture(editOnlyTenantId, `brand-edit-only-${fixtureRunId}`);
    const digest = "c".repeat(64);
    const request = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url, origin)
       values ($1, $2, 'upload') returning request_id`,
      [editOnlyTenantId, `upload:${digest}`],
    );
    const proposal = await pool.query<{ proposal_id: string }>(
      `insert into brand_proposals
        (request_id, tenant_id, status, proposed_values, parser_version,
         reviewed_at, reviewed_policy_version)
       values ($1, $2, 'reviewed', $3::jsonb, 'brand-md-v1', now(), 4)
       returning proposal_id`,
      [
        request.rows[0]!.request_id,
        editOnlyTenantId,
        JSON.stringify({
          displayName: {
            value: "Before",
            fileDigest: digest,
            uploadedByUserId: "usr_uploader",
            uploadedAt: "2026-07-30T08:00:00Z",
          },
          legalLinks: {
            value: [{
              label: "Privacy",
              url: "https://www.example.test/privacy",
            }],
            fileDigest: digest,
            uploadedByUserId: "usr_uploader",
            uploadedAt: "2026-07-30T08:00:00Z",
          },
        }),
      ],
    );
    const proposalId = proposal.rows[0]!.proposal_id;
    const store = new PgBrandProposalStore(pool);

    await store.edit({
      proposalId,
      tenantId: editOnlyTenantId,
      actor: { kind: "user", userId: "usr_editor" },
      reason: " Correct tenant display name ",
      values: {
        displayName: "After",
        legalLinks: [{
          label: "Privacy",
          url: "https://www.example.test/privacy",
        }],
      },
    });

    const stored = await pool.query<{
      request_id: string;
      parser_version: string;
      status: string;
      reviewed_at: Date | null;
      reviewed_policy_version: number | null;
      proposed_values: Record<string, Record<string, unknown>>;
    }>(
      `select request_id, parser_version, status, reviewed_at,
              reviewed_policy_version, proposed_values
         from brand_proposals where proposal_id = $1`,
      [proposalId],
    );
    expect(stored.rows[0]).toMatchObject({
      request_id: request.rows[0]!.request_id,
      parser_version: "brand-md-v1",
      status: "draft",
      reviewed_at: null,
      reviewed_policy_version: null,
      proposed_values: {
        displayName: {
          value: "After",
          fileDigest: digest,
          uploadedByUserId: "usr_uploader",
          uploadedAt: "2026-07-30T08:00:00Z",
        },
      },
    });
    const audits = await pool.query<{
      actor: { userId: string };
      detail: { reason: string };
    }>(
      `select actor, detail from audit_events
        where tenant_id = $1 and action = 'brand.proposal.edited' and subject = $2`,
      [editOnlyTenantId, proposalId],
    );
    expect(audits.rows).toEqual([{
      actor: { kind: "user", userId: "usr_editor" },
      detail: { reason: "Correct tenant display name" },
    }]);

    await expect(store.edit({
      proposalId,
      tenantId: editOnlyTenantId,
      actor: { kind: "user", userId: "usr_editor" },
      reason: "No-op edit",
      values: {
        displayName: "After",
        legalLinks: [{
          label: "Privacy",
          url: "https://www.example.test/privacy",
        }],
      },
    })).rejects.toThrow("changed values");
    expect((await pool.query(
      `select 1 from audit_events
        where tenant_id = $1 and action = 'brand.proposal.edited' and subject = $2`,
      [editOnlyTenantId, proposalId],
    )).rows).toHaveLength(1);
  });

  it("gives edit versus apply one coherent winner while preserving upload provenance", async () => {
    await createBrandFixture(editTenantId, `brand-edit-${fixtureRunId}`);
    const digest = "d".repeat(64);
    const request = await pool.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url, origin)
       values ($1, $2, 'upload') returning request_id`,
      [editTenantId, `upload:${digest}`],
    );
    const proposal = await pool.query<{ proposal_id: string }>(
      `insert into brand_proposals
        (request_id, tenant_id, status, proposed_values, parser_version,
         reviewed_at, reviewed_policy_version)
       values ($1, $2, 'reviewed', $3::jsonb, 'brand-md-v1', now(), 4)
       returning proposal_id`,
      [
        request.rows[0]!.request_id,
        editTenantId,
        JSON.stringify({
          displayName: {
            value: "Before",
            fileDigest: digest,
            uploadedByUserId: "usr_uploader",
            uploadedAt: "2026-07-30T08:00:00Z",
          },
        }),
      ],
    );
    const proposalId = proposal.rows[0]!.proposal_id;
    const store = new PgBrandProposalStore(pool);

    const results = await Promise.allSettled([
      store.edit({
        proposalId,
        tenantId: editTenantId,
        actor: { kind: "user", userId: "usr_editor" },
        reason: "Correct tenant display name",
        values: { displayName: "After" },
      }),
      store.apply({
        proposalId,
        tenantId: editTenantId,
        actor: { kind: "user", userId: "usr_applier" },
        reason: "Apply reviewed upload",
        appliedAt: new Date(),
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const stored = await pool.query<{
      request_id: string;
      parser_version: string;
      status: string;
      reviewed_at: Date | null;
      reviewed_policy_version: number | null;
      proposed_values: Record<string, Record<string, unknown>>;
    }>(
      `select request_id, parser_version, status, reviewed_at,
              reviewed_policy_version, proposed_values
         from brand_proposals where proposal_id = $1`,
      [proposalId],
    );
    expect(stored.rows[0]).toMatchObject({
      request_id: request.rows[0]!.request_id,
      parser_version: "brand-md-v1",
    });
    expect(stored.rows[0]!.proposed_values.displayName).toMatchObject({
      fileDigest: digest,
      uploadedByUserId: "usr_uploader",
      uploadedAt: "2026-07-30T08:00:00Z",
    });

    const audits = await pool.query<{ action: string }>(
      `select action from audit_events
        where tenant_id = $1
          and action in ('brand.proposal.edited', 'brand.proposal.applied')
        order by action`,
      [editTenantId],
    );
    expect(audits.rows).toHaveLength(1);
    if (stored.rows[0]!.status === "draft") {
      expect(stored.rows[0]).toMatchObject({
        reviewed_at: null,
        reviewed_policy_version: null,
      });
      expect(stored.rows[0]!.proposed_values.displayName!.value).toBe("After");
      expect(audits.rows).toEqual([{ action: "brand.proposal.edited" }]);
      expect((await pool.query<{ version: number }>(
        "select version from brand_policies where tenant_id = $1",
        [editTenantId],
      )).rows[0]!.version).toBe(4);
    } else {
      expect(stored.rows[0]!.status).toBe("applied");
      expect(stored.rows[0]!.proposed_values.displayName!.value).toBe("Before");
      expect(audits.rows).toEqual([{ action: "brand.proposal.applied" }]);
    }
  });
});
