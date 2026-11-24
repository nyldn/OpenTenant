vi.mock("../../../../lib/settings-rate-limit", () => ({ enforceMutationRateLimit: () => null }));
vi.mock("../../../../lib/tenant", () => ({ currentTenant: async () => ({ tenantId: "ten_example" }) }));
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

const harness = vi.hoisted(() => ({
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  appendWithClient: vi.fn(),
  applyBrandProposal: vi.fn(),
  editBrandProposal: vi.fn(),
  reviewBrandProposal: vi.fn(),
  revokeBrandProposal: vi.fn(),
  uploadBrandProposal: vi.fn(),
  brandProposalAdminContext: vi.fn(),
  readBrandDocumentUpload: vi.fn(),
  parseBrandDocumentUpload: vi.fn(),
  sameOrigin: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    readonly connect = harness.connect;
  },
}));

vi.mock("@opentenant/database", () => ({
  PgAuditStore: class {
    readonly appendWithClient = harness.appendWithClient;
  },
  PgBrandProposalStore: class {
    readonly apply = harness.applyBrandProposal;
    readonly edit = harness.editBrandProposal;
    readonly review = harness.reviewBrandProposal;
    readonly revoke = harness.revokeBrandProposal;
    readonly upload = harness.uploadBrandProposal;
  },
  BrandProposalConflictError: class extends Error {},
  BrandProposalSupersedeRequiredError: class extends Error {},
  BrandProposalValidationError: class extends Error {},
}));

vi.mock("../../../../lib/tenant-admin", () => ({
  brandProposalAdminContext: harness.brandProposalAdminContext,
}));
vi.mock("../../../../lib/settings-guard", () => ({
  sameOrigin: harness.sameOrigin,
  auditActor: vi.fn((session: { userId: string }) => ({ kind: "user", userId: session.userId })),
}));
vi.mock("../../../../lib/brand-document-upload", () => ({
  readBrandDocumentUpload: harness.readBrandDocumentUpload,
  parseBrandDocumentUpload: harness.parseBrandDocumentUpload,
}));

import { POST } from "./route";
import {
  BrandProposalConflictError,
  BrandProposalSupersedeRequiredError,
  BrandProposalValidationError,
} from "@opentenant/database";

const proposalId = "71b8d1b6-50fd-4d5d-b8d0-d815dd2597c3";

function request(action: "request" | "upload" | "review" | "edit" | "discard" | "apply", sourceUrl?: string): Request {
  if (action === "upload") {
    const form = new FormData();
    form.set("tenantId", "ten_example");
    form.set("action", "upload");
    form.set(
      "brandDocument",
      new File(["# Display Name\nExample Organisation"], "brand.md", {
        type: "text/markdown",
      }),
    );
    return new Request("https://app.example.test/api/admin/brand-proposals", {
      method: "POST",
      body: form,
    });
  }
  const body = new URLSearchParams({
    tenantId: "ten_example",
    proposalId,
    action,
  });
  if (sourceUrl) body.set("sourceUrl", sourceUrl);
  if (action === "review") body.set("reason", "Values checked against source evidence");
  if (action === "edit") {
    body.set("reason", "Corrected tenant display name");
    body.set("value.displayName", "Corrected Organisation");
  }
  if (action === "discard") body.set("reason", "Proposal no longer represents the tenant");
  if (action === "apply") body.set("reason", "Approved after review");
  return new Request("https://app.example.test/api/admin/brand-proposals", {
    method: "POST",
    body,
  });
}

describe("tenant-bound brand proposal actions", () => {
  beforeEach(() => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://app.example.test/opentenant");
    harness.connect.mockReset().mockResolvedValue({
      query: harness.clientQuery,
      release: harness.release,
    });
    harness.clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    harness.release.mockReset();
    harness.appendWithClient.mockReset().mockResolvedValue({ sequence: 51, hash: "audit_hash_51" });
    harness.applyBrandProposal.mockReset().mockResolvedValue({
      policyVersion: 5,
      appliedKeys: ["displayName"],
      rejectedKeys: [],
    });
    harness.editBrandProposal.mockReset().mockResolvedValue(undefined);
    harness.reviewBrandProposal.mockReset().mockResolvedValue(undefined);
    harness.revokeBrandProposal.mockReset().mockResolvedValue(undefined);
    harness.uploadBrandProposal.mockReset().mockResolvedValue({
      proposalId,
      requestId: "request_upload",
      duplicate: false,
      supersededProposalId: null,
      status: "draft",
    });
    harness.readBrandDocumentUpload.mockReset().mockImplementation(async (req: Request) => {
      const form = await req.formData();
      if (form.get("action") !== "upload") {
        return { ok: true, value: { kind: "form", form } };
      }
      return {
        ok: true,
        value: {
          kind: "upload",
          tenantId: "ten_example",
          bytes: new TextEncoder().encode("# Display Name\nExample Organisation"),
          fileName: "brand.md",
          mediaType: "text/markdown",
        },
      };
    });
    harness.parseBrandDocumentUpload.mockReset().mockReturnValue({
      ok: true,
      value: {
        fileDigest: "a".repeat(64),
        parserVersion: "brand-md-v1",
        values: { displayName: "Example Organisation" },
      },
    });
    harness.sameOrigin.mockReset().mockReturnValue(true);
    harness.brandProposalAdminContext.mockReset().mockResolvedValue({
      ok: true,
      context: {
        tenantId: "ten_example",
        session: {
          userId: "usr_tenant_admin",
          activeTenantId: "ten_example",
          activeRole: "tenant_admin",
          permissions: [
            "brand.proposal.upload",
            "brand.proposal.review",
            "brand.proposal.apply",
            "brand.proposal.revoke",
          ],
          isPlatformAdmin: false,
        },
      },
    });
  });

  it("uploads only through same-origin brand.proposal.upload authority and never reviews or applies", async () => {
    const response = await POST(request("upload"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/admin/tenants/ten_example/brand-proposals?upload=created",
    );
    expect(harness.brandProposalAdminContext).toHaveBeenCalledExactlyOnceWith(
      "ten_example",
      "brand.proposal.upload",
    );
    expect(harness.uploadBrandProposal).toHaveBeenCalledWith({
      tenantId: "ten_example",
      actor: { kind: "user", userId: "usr_tenant_admin" },
      fileDigest: "a".repeat(64),
      parserVersion: "brand-md-v1",
      uploadedAt: expect.any(Date),
      values: { displayName: "Example Organisation" },
      allowSupersede: false,
    });
    expect(harness.reviewBrandProposal).not.toHaveBeenCalled();
    expect(harness.applyBrandProposal).not.toHaveBeenCalled();

    harness.uploadBrandProposal.mockResolvedValueOnce({
      proposalId,
      requestId: "request_upload",
      duplicate: true,
      supersededProposalId: null,
      status: "draft",
    });
    const duplicate = await POST(request("upload"));
    expect(duplicate.headers.get("location")).toContain("?upload=duplicate");
  });

  it("passes supersede authority only when the active tenant session has it", async () => {
    harness.brandProposalAdminContext.mockResolvedValueOnce({
      ok: true,
      context: {
        tenantId: "ten_example",
        session: {
          userId: "usr_tenant_admin",
          activeTenantId: "ten_example",
          activeRole: "tenant_admin",
          permissions: ["brand.proposal.upload", "brand.proposal.supersede"],
          isPlatformAdmin: false,
        },
      },
    });

    const response = await POST(request("upload"));

    expect(response.status).toBe(303);
    expect(harness.uploadBrandProposal).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "ten_example",
      allowSupersede: true,
    }));
  });

  it("returns forbidden when a different upload would supersede without authority", async () => {
    harness.uploadBrandProposal.mockRejectedValueOnce(
      new BrandProposalSupersedeRequiredError(),
    );

    const response = await POST(request("upload"));

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("forbidden");
  });

  it("rejects cross-origin upload before reading or authorizing its body", async () => {
    harness.sameOrigin.mockReturnValueOnce(false);

    const response = await POST(request("upload"));

    expect(response.status).toBe(403);
    expect(harness.readBrandDocumentUpload).not.toHaveBeenCalled();
    expect(harness.brandProposalAdminContext).not.toHaveBeenCalled();
    expect(harness.uploadBrandProposal).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "upload_too_large", status: 413 }, 413, "upload_too_large"],
    [{ code: "unsupported_media_type", status: 415 }, 415, "unsupported_media_type"],
    [{ code: "invalid_upload", status: 400 }, 400, "invalid_upload"],
  ] as const)("returns bounded upload error %#", async (error, status, code) => {
    harness.readBrandDocumentUpload.mockResolvedValueOnce({ ok: false, error });

    const response = await POST(request("upload"));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(harness.brandProposalAdminContext).not.toHaveBeenCalled();
  });

  it("returns bounded parser reasons without starting a transaction", async () => {
    harness.parseBrandDocumentUpload.mockReturnValueOnce({
      ok: false,
      error: {
        code: "invalid_document",
        status: 422,
        issues: ["displayName: duplicate key"],
      },
    });

    const response = await POST(request("upload"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "invalid_document",
      issues: ["displayName: duplicate key"],
    });
    expect(harness.uploadBrandProposal).not.toHaveBeenCalled();
  });

  it("fails closed before database work without the exact tenant authority", async () => {
    harness.brandProposalAdminContext.mockResolvedValueOnce({
      ok: false,
      reason: "forbidden",
    });

    const response = await POST(request("review"));

    expect(response.status).toBe(403);
    expect(harness.brandProposalAdminContext).toHaveBeenCalledExactlyOnceWith(
      "ten_example",
      "brand.proposal.review",
    );
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it("reviews only a tenant-bound draft with populated provenanced values and audits atomically", async () => {
    const response = await POST(request("review"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/admin/tenants/ten_example/brand-proposals",
    );
    expect(harness.brandProposalAdminContext).toHaveBeenCalledExactlyOnceWith(
      "ten_example",
      "brand.proposal.review",
    );
    expect(harness.reviewBrandProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "ten_example",
        proposalId,
        actor: { kind: "user", userId: "usr_tenant_admin" },
        reason: expect.any(String),
      }),
    );
  });

  it("provides a tenant administrator retry path for a failed optional seed enqueue", async () => {
    harness.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("insert into brand_seed_requests")) {
        return { rows: [{ request_id: proposalId }], rowCount: 1 };
      }
      return { rows: [], rowCount: null };
    });

    const response = await POST(request("request", "https://www.example.test/about"));

    expect(response.status).toBe(303);
    expect(harness.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("insert into brand_seed_requests"),
      ["ten_example", "https://www.example.test/about"],
    );
    expect(harness.appendWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "brand.seed.requested" }),
    );
  });

  it.each([
    "http://www.example.test",
    "https://user:password@www.example.test",
    "https://www.example.test:8443",
    `https://www.example.test/${"a".repeat(2048)}`,
  ])("rejects unsafe retry source %s before database work", async (sourceUrl) => {
    const response = await POST(request("request", sourceUrl));

    expect(response.status).toBe(400);
    expect(harness.connect).not.toHaveBeenCalled();
    expect(harness.appendWithClient).not.toHaveBeenCalled();
  });

  it("returns an actionable conflict when another source already has a live draft", async () => {
    harness.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("insert into brand_seed_requests")) {
        return { rows: [{ request_id: proposalId }], rowCount: 1 };
      }
      if (sql.includes("insert into brand_proposals")) {
        throw Object.assign(new Error("synthetic unique violation"), {
          code: "23505",
          constraint: "brand_proposals_one_live_draft",
        });
      }
      return { rows: [], rowCount: null };
    });

    const response = await POST(request("request", "https://other.example.test/about"));

    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "discard the existing draft before requesting another source",
    );
    expect(harness.clientQuery).toHaveBeenCalledWith("rollback");
    expect(harness.appendWithClient).not.toHaveBeenCalled();
  });

  it("discards a tenant-bound draft or reviewed proposal, cancels its request, and audits atomically", async () => {
    const response = await POST(request("discard"));

    expect(response.status).toBe(303);
    expect(harness.brandProposalAdminContext).toHaveBeenCalledExactlyOnceWith(
      "ten_example",
      "brand.proposal.revoke",
    );
    expect(harness.revokeBrandProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "ten_example",
        proposalId,
        reason: "Proposal no longer represents the tenant",
      }),
    );
  });

  it("edits through the exact tenant-bound permission with actor, reason, and values", async () => {
    const response = await POST(request("edit"));

    expect(response.status).toBe(303);
    expect(harness.brandProposalAdminContext).toHaveBeenCalledExactlyOnceWith(
      "ten_example",
      "brand.proposal.edit",
    );
    expect(harness.editBrandProposal).toHaveBeenCalledWith({
      proposalId,
      tenantId: "ten_example",
      actor: { kind: "user", userId: "usr_tenant_admin" },
      reason: "Corrected tenant display name",
      values: { displayName: "Corrected Organisation" },
    });
  });

  it("rejects unknown edit keys before calling the store", async () => {
    const invalid = request("edit");
    const form = await invalid.formData();
    form.delete("value.displayName");
    form.set("value.unknownToken", "surprise");

    const response = await POST(new Request(invalid.url, { method: "POST", body: form }));

    expect(response.status).toBe(400);
    expect(harness.editBrandProposal).not.toHaveBeenCalled();
  });

  it("returns an actionable conflict when a reviewed edit would create a second draft", async () => {
    harness.editBrandProposal.mockRejectedValueOnce(
      new BrandProposalConflictError(
        "discard the existing draft before editing this reviewed proposal",
      ),
    );

    const response = await POST(request("edit"));

    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "discard the existing draft before editing this reviewed proposal",
    );
  });

  it("maps only declared edit validation failures to 400", async () => {
    harness.editBrandProposal.mockRejectedValueOnce(
      new BrandProposalValidationError("Brand proposal edit requires changed values"),
    );
    expect((await POST(request("edit"))).status).toBe(400);

    harness.editBrandProposal.mockRejectedValueOnce(new TypeError("driver failure"));
    expect((await POST(request("edit"))).status).toBe(500);
  });

  it("stops all mutation when tenant authority denies the request", async () => {
    harness.brandProposalAdminContext.mockResolvedValueOnce({ ok: false, reason: "anonymous" });
    const response = await POST(request("review"));

    expect(response.status).toBe(403);
    expect(harness.reviewBrandProposal).not.toHaveBeenCalled();
    expect(harness.applyBrandProposal).not.toHaveBeenCalled();
    expect(harness.editBrandProposal).not.toHaveBeenCalled();
    expect(harness.revokeBrandProposal).not.toHaveBeenCalled();
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it.each(["review", "discard"] as const)("requires an operator reason for %s", async (action) => {
    const invalid = request(action);
    const form = await invalid.formData();
    form.delete("reason");
    const response = await POST(new Request(invalid.url, { method: "POST", body: form }));

    expect(response.status).toBe(400);
    expect(harness.reviewBrandProposal).not.toHaveBeenCalled();
    expect(harness.revokeBrandProposal).not.toHaveBeenCalled();
  });

  it("delegates apply to the atomic store with actor and reason", async () => {
    const response = await POST(request("apply"));

    expect(response.status).toBe(303);
    expect(harness.connect).not.toHaveBeenCalled();
    expect(harness.applyBrandProposal).toHaveBeenCalledWith(expect.objectContaining({
      proposalId,
      tenantId: "ten_example",
      actor: { kind: "user", userId: "usr_tenant_admin" },
      reason: "Approved after review",
      appliedAt: expect.any(Date),
    }));
  });
});
