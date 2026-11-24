import { describe, expect, it } from "vitest";
import {
  SyntheticEvidenceExportAdapter,
  createEvidenceScopeVersion,
  verifyEvidenceExport,
} from "./index";

const allowed = {
  decision: "allow" as const,
  actorId: "user_owner",
  permission: "owner.evidence.export",
  policyVersion: "policy_7",
  reason: "quarterly_access_review",
};

function tenantScope() {
  return createEvidenceScopeVersion({
    connectionId: "conn_tenant_a",
    scopeId: "scope_tenant_a",
    version: 1,
    consentId: "consent_1",
    kind: "tenant",
    installationId: "installation_example",
    tenantIds: ["tenant_a"],
    resourceTypes: ["access_review"],
    allowedFields: ["eventId", "outcome"],
    purpose: "future_soc2_programme_support",
    region: "eu",
    aggregationRule: "none",
    retentionDays: 30,
    createdAt: "2026-07-28T10:00:00.000Z",
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job_1",
    idempotencyKey: "evidence:scope_tenant_a:1:window_1",
    connectionId: "conn_tenant_a",
    scopeId: "scope_tenant_a",
    scopeVersion: 1,
    authorization: allowed,
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-28T00:00:00.000Z",
    maxRecords: 10,
    records: [
      {
        evidenceId: "evidence_1",
        tenantId: "tenant_a",
        resourceType: "access_review",
        occurredAt: "2026-07-20T12:00:00.000Z",
        fields: {
          eventId: "event_1",
          outcome: "approved",
          ticketBody: "must never leave the tenant",
        },
        sourceDigest: "sha256:source_1",
      },
    ],
    ...overrides,
  };
}

describe("evidence export scope versions", () => {
  it("freezes exact tenant and owner aggregate membership into immutable versions", () => {
    const tenant = tenantScope();
    expect(Object.isFrozen(tenant)).toBe(true);
    expect(Object.isFrozen(tenant.tenantIds)).toBe(true);
    expect(() => tenant.tenantIds.push("tenant_b")).toThrow();

    const owner = createEvidenceScopeVersion({
      ...tenant,
      connectionId: "conn_owner",
      scopeId: "scope_owner",
      kind: "installation_owner",
      tenantIds: ["tenant_a", "tenant_b"],
      aggregationRule: "count_by_control",
      consentId: "consent_owner_1",
    });
    expect(owner.tenantIds).toEqual(["tenant_a", "tenant_b"]);
    expect(owner.scopeDigest).not.toBe(tenant.scopeDigest);
  });

  it("rejects an aggregate tenant scope and empty automatically expanding owner scope", () => {
    expect(() =>
      createEvidenceScopeVersion({
        ...tenantScope(),
        aggregationRule: "count_by_control",
      }),
    ).toThrow(/tenant scope/i);
    expect(() =>
      createEvidenceScopeVersion({
        ...tenantScope(),
        kind: "installation_owner",
        tenantIds: [],
        aggregationRule: "count_by_control",
      }),
    ).toThrow(/explicit tenant/i);
  });
});

describe("SyntheticEvidenceExportAdapter", () => {
  it("requires explicit authorization and bounded requests", async () => {
    const adapter = new SyntheticEvidenceExportAdapter([tenantScope()]);
    await expect(
      adapter.exportEvidence(request({
        authorization: { ...allowed, decision: "deny" },
      })),
    ).rejects.toThrow(/authoriz/i);
    await expect(adapter.exportEvidence(request({ maxRecords: 101 }))).rejects.toThrow(/bound/i);
    await expect(
      adapter.exportEvidence(request({ from: "2025-01-01T00:00:00.000Z" })),
    ).rejects.toThrow(/window/i);
  });

  it("denies cross-tenant and unapproved resource export", async () => {
    const adapter = new SyntheticEvidenceExportAdapter([tenantScope()]);
    const foreign = {
      ...request().records[0],
      tenantId: "tenant_b",
    };
    await expect(adapter.exportEvidence(request({ records: [foreign] }))).rejects.toThrow(
      /tenant/i,
    );
    const unknown = {
      ...request().records[0],
      resourceType: "ticket_content",
    };
    await expect(adapter.exportEvidence(request({ records: [unknown] }))).rejects.toThrow(
      /resource/i,
    );
  });

  it("redacts every non-allowlisted field and produces a verifiable integrity chain", async () => {
    const adapter = new SyntheticEvidenceExportAdapter([tenantScope()]);
    const result = await adapter.exportEvidence(request());
    expect(result.records[0]?.fields).toEqual({
      eventId: "event_1",
      outcome: "approved",
    });
    expect(result.records[0]?.redactedFields).toEqual(["ticketBody"]);
    expect(JSON.stringify(result)).not.toContain("must never leave the tenant");
    expect(verifyEvidenceExport(result)).toEqual({ intact: true, failure: null });

    const tampered = structuredClone(result);
    tampered.records[0]!.fields.outcome = "changed";
    expect(verifyEvidenceExport(tampered)).toEqual({
      intact: false,
      failure: "digest_mismatch",
    });
  });

  it("stops immediately after one-way revocation", async () => {
    const adapter = new SyntheticEvidenceExportAdapter([tenantScope()]);
    expect(adapter.revokeScope({
      scopeId: "scope_tenant_a",
      version: 1,
      revokedAt: "2026-07-28T10:30:00.000Z",
      disposition: "synthetic_exports_deleted",
    })).toBe("revoked");
    expect(adapter.revokeScope({
      scopeId: "scope_tenant_a",
      version: 1,
      revokedAt: "2026-07-28T10:31:00.000Z",
      disposition: "retained",
    })).toBe("already_revoked");
    await expect(adapter.exportEvidence(request({ jobId: "job_2" }))).rejects.toThrow(/revoked/i);
  });

  it("deduplicates the same idempotency key without duplicating delivery", async () => {
    const adapter = new SyntheticEvidenceExportAdapter([tenantScope()]);
    const first = await adapter.exportEvidence(request());
    const duplicate = await adapter.exportEvidence(request({ jobId: "job_retry" }));
    expect(duplicate).toEqual(first);
    expect(adapter.deliveryCount()).toBe(1);
    await expect(
      adapter.exportEvidence(request({ records: [], jobId: "job_conflict" })),
    ).rejects.toThrow(/idempotency/i);
  });

  it("reconciles a scoped canonical checkpoint without inventing exported records", async () => {
    const adapter = new SyntheticEvidenceExportAdapter([tenantScope()]);
    await adapter.exportEvidence(request());
    expect(
      adapter.reconcile({
        connectionId: "conn_tenant_a",
        scopeId: "scope_tenant_a",
        scopeVersion: 1,
        canonicalEvidenceIds: ["evidence_1", "evidence_2"],
        canonicalCheckpoint: "checkpoint_2",
      }),
    ).toEqual({
      status: "lagging",
      exportedEvidenceIds: ["evidence_1"],
      missingEvidenceIds: ["evidence_2"],
      adapterCheckpoint: "evidence_1",
      canonicalCheckpoint: "checkpoint_2",
    });
  });
});
