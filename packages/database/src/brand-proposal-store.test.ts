import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { TenantId } from "@opentenant/auth";
import { BrandProposalConflictError, PgBrandProposalStore } from "./brand-proposal-store";

const tenantId = "ten_example" as TenantId;
const proposalId = "71b8d1b6-50fd-4d5d-b8d0-d815dd2597c3";

describe("PgBrandProposalStore", () => {
  const query = vi.fn();
  const release = vi.fn();
  const pool = {
    connect: vi.fn(async () => ({ query, release }) as unknown as PoolClient),
    query: vi.fn(),
  } as unknown as Pool;

  beforeEach(() => {
    query.mockReset();
    release.mockReset();
    vi.mocked(pool.connect).mockClear();
    vi.mocked(pool.query).mockReset();
  });

  it("creates a tenant-bound upload draft and audit in one transaction", async () => {
    const uploadedAt = new Date("2026-09-06T15:00:00.000Z");
    const digest = "a".repeat(64);
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ tenant_id: tenantId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ request_id: "request_upload" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ proposal_id: proposalId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const result = await new PgBrandProposalStore(pool).upload({
      tenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      fileDigest: digest,
      parserVersion: "brand-md-v1",
      uploadedAt,
      values: {
        displayName: "Example Organisation",
        colorPrimary: "#123456",
      },
    });

    expect(result).toEqual({
      proposalId,
      requestId: "request_upload",
      duplicate: false,
      supersededProposalId: null,
      status: "draft",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("from tenants"),
      [tenantId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into brand_seed_requests"),
      [tenantId, `upload:${digest}`, uploadedAt],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into brand_proposals"),
      [
        "request_upload",
        tenantId,
        JSON.stringify({
          colorPrimary: {
            value: "#123456",
            fileDigest: digest,
            uploadedByUserId: "usr_tenant_admin",
            uploadedAt: uploadedAt.toISOString(),
          },
          displayName: {
            value: "Example Organisation",
            fileDigest: digest,
            uploadedByUserId: "usr_tenant_admin",
            uploadedAt: uploadedAt.toISOString(),
          },
        }),
        "brand-md-v1",
        uploadedAt,
      ],
    );
    const auditInsert = query.mock.calls.find(([sql]) => String(sql).includes("insert into audit_events"));
    expect(auditInsert?.[1]).toEqual(expect.arrayContaining([
      tenantId,
      expect.stringContaining('"userId":"usr_tenant_admin"'),
      "brand.proposal.uploaded",
      proposalId,
      expect.stringContaining(`"fileDigest":"${digest}"`),
    ]));
    expect(query).toHaveBeenLastCalledWith("commit");
  });

  it("returns the existing proposal for an identical digest without auditing again", async () => {
    const digest = "b".repeat(64);
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ tenant_id: tenantId }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ request_id: "request_existing", proposal_id: proposalId, status: "reviewed" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const result = await new PgBrandProposalStore(pool).upload({
      tenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      fileDigest: digest,
      parserVersion: "brand-md-v1",
      uploadedAt: new Date("2026-09-06T15:00:00.000Z"),
      values: { displayName: "Ignored duplicate" },
    });

    expect(result).toEqual({
      proposalId,
      requestId: "request_existing",
      duplicate: true,
      supersededProposalId: null,
      status: "reviewed",
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into brand_seed_requests")))
      .toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into audit_events")))
      .toBe(false);
  });

  it("refuses to replace a different draft without an explicit supersede grant", async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ tenant_id: tenantId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ proposal_id: proposalId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(new PgBrandProposalStore(pool).upload({
      tenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      fileDigest: "c".repeat(64),
      parserVersion: "brand-md-v1",
      uploadedAt: new Date("2026-09-06T15:00:00.000Z"),
      values: { displayName: "Replacement" },
      allowSupersede: false,
    })).rejects.toThrow("brand proposal supersede permission is required");

    expect(query.mock.calls.some(([sql]) => String(sql).includes("set status = 'superseded'")))
      .toBe(false);
    expect(query).toHaveBeenLastCalledWith("rollback");
  });

  it("reports locked proposal keys with a stable reason before confirmation", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        status: "reviewed",
        reviewed_policy_version: 4,
        policy_version: 4,
        locked_keys: ["logoUrl"],
        proposed_values: {
          displayName: { value: "Example Organisation" },
          logoUrl: { value: "https://cdn.example.test/logo.svg" },
          colorPrimary: { value: "#123456" },
        },
      }],
    } as never);

    const preview = await new PgBrandProposalStore(pool).preview(proposalId, tenantId);

    expect(preview).toEqual({
      proposalId,
      tenantId,
      policyVersion: 4,
      applicableKeys: ["colorPrimary", "displayName"],
      rejectedKeys: [{ key: "logoUrl", reason: "locked_by_policy" }],
    });
  });

  it("reviews through the tenant-bound store seam and appends canonical evidence", async () => {
    const reviewedAt = new Date("2026-07-30T10:00:00.000Z");
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ reviewed_at: reviewedAt }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await new PgBrandProposalStore(pool).review({
      proposalId,
      tenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      reason: "Values checked against the uploaded document",
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("reviewed_policy_version = policy.version"),
      [proposalId, tenantId],
    );
    expect(query.mock.calls.find(([sql]) => String(sql).includes("insert into audit_events"))?.[1])
      .toEqual(expect.arrayContaining([
        tenantId,
        expect.stringContaining('"userId":"usr_tenant_admin"'),
        "brand.proposal.reviewed",
        proposalId,
        expect.stringContaining("Values checked"),
      ]));
  });

  it("revokes through the tenant-bound store seam and cancels the source request", async () => {
    const revokedAt = new Date("2026-07-30T10:00:00.000Z");
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{ request_id: "seed_request_id", discarded_at: revokedAt }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await new PgBrandProposalStore(pool).revoke({
      proposalId,
      tenantId,
      actor: { kind: "user", userId: "usr_tenant_admin" },
      reason: "Proposal no longer represents the tenant",
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status in ('draft', 'reviewed')"),
      [proposalId, tenantId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("update brand_seed_requests"),
      ["seed_request_id", tenantId, revokedAt],
    );
  });

  it("atomically merges unlocked values, increments once, terminates, and audits the reason", async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{
          status: "reviewed",
          reviewed_policy_version: 7,
          policy_version: 7,
          locked_keys: ["logoUrl"],
          proposed_values: {
            displayName: { value: "Example Organisation" },
            logoUrl: { value: "https://cdn.example.test/logo.svg" },
            colorPrimary: { value: "#123456" },
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ version: 8 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ proposal_id: proposalId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const applied = await new PgBrandProposalStore(pool).apply({
      proposalId,
      tenantId,
      actor: { kind: "installation_owner", userId: "usr_owner" },
      reason: "Approved after brand review",
      appliedAt: new Date("2026-07-29T10:00:00.000Z"),
    });

    expect(applied.policyVersion).toBe(8);
    expect(applied.appliedKeys).toEqual(["colorPrimary", "displayName"]);
    expect(applied.rejectedKeys).toEqual([{ key: "logoUrl", reason: "locked_by_policy" }]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("overrides = overrides || $2::jsonb"),
      [
        tenantId,
        JSON.stringify({ colorPrimary: "#123456", displayName: "Example Organisation" }),
        7,
        new Date("2026-07-29T10:00:00.000Z"),
      ],
    );
    const auditInsert = query.mock.calls.find(([sql]) => String(sql).includes("insert into audit_events"));
    expect(auditInsert?.[1]).toEqual(expect.arrayContaining([
      tenantId,
      expect.any(String),
      "brand.proposal.applied",
      proposalId,
      expect.stringContaining('"policyVersion":8'),
    ]));
    expect(query).toHaveBeenLastCalledWith("commit");
  });

  it("rolls back version drift without touching policy or audit state", async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{
          status: "reviewed",
          reviewed_policy_version: 3,
          policy_version: 4,
          locked_keys: [],
          proposed_values: { displayName: { value: "Stale" } },
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(new PgBrandProposalStore(pool).apply({
      proposalId,
      tenantId,
      actor: { kind: "installation_owner", userId: "usr_owner" },
      reason: "Stale approval",
      appliedAt: new Date("2026-07-29T10:00:00.000Z"),
    })).rejects.toBeInstanceOf(BrandProposalConflictError);

    expect(query.mock.calls.some(([sql]) => String(sql).includes("update brand_policies"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into audit_events"))).toBe(false);
    expect(query).toHaveBeenLastCalledWith("rollback");
  });
});
