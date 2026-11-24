import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  brandProposalTenantContext: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("pg", () => ({
  Pool: class {
    readonly query = mocks.query;
  },
}));
vi.mock("../../../../../lib/tenant-admin", () => ({
  brandProposalTenantContext: mocks.brandProposalTenantContext,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import BrandProposalsPage from "./page";
import BrandDocumentUploadForm from "./brand-document-upload-form";

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join(" ");
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function elements(value: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== "object" || value === null || !("props" in value)) return [];
  const element = value as { type?: unknown; props?: Record<string, unknown> };
  return [element, ...elements(element.props?.children)];
}

beforeEach(() => {
  vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://app.example.test/opentenant");
  mocks.brandProposalTenantContext.mockReset().mockResolvedValue({
    ok: true,
    context: {
      tenantId: "ten_example",
      session: {
        permissions: [
          "brand.proposal.upload",
          "brand.proposal.review",
          "brand.proposal.edit",
          "brand.proposal.apply",
          "brand.proposal.revoke",
        ],
      },
    },
  });
  mocks.query.mockReset().mockResolvedValue({
    rows: [{
      display_name: "Example Organisation",
      proposal_id: "71b8d1b6-50fd-4d5d-b8d0-d815dd2597c3",
      source_url: "https://www.example.test/about",
      request_status: "completed",
      proposal_status: "draft",
      source_kind: "https",
      source_at: new Date("2026-07-22T08:00:00.000Z"),
      proposed_values: {
        displayName: {
          value: "Example Organisation",
          sourceUrl: "https://www.example.test/about",
          retrievedAt: "2026-07-22T08:00:00.000Z",
        },
      },
      created_at: new Date("2026-07-22T08:00:00.000Z"),
    }],
  });
});

it("shows provenanced values and usable review and discard actions", async () => {
  const result = await BrandProposalsPage({
    params: Promise.resolve({ tenantId: "ten_example" }),
  });
  const tree = elements(result);

  expect(textContent(result)).toContain("Example Organisation");
  expect(textContent(result)).toContain("https://www.example.test/about");
  expect(textContent(result)).toContain("2026-07-22T08:00:00.000Z");
  expect(tree.filter((element) => element.type === "form"
    && element.props?.action === "/api/admin/brand-proposals")).toHaveLength(4);
  expect(textContent(result)).toContain("Request proposal");
  expect(textContent(result)).toContain("Review proposal");
  expect(textContent(result)).toContain("Save edits and require new review");
  expect(textContent(result)).toContain("Discard proposal");
});

it("offers the bounded brand.md upload contract and explains that it stays a draft", async () => {
  const result = await BrandProposalsPage({
    params: Promise.resolve({ tenantId: "ten_example" }),
  });
  const tree = elements(result);
  const uploadForm = tree.find((element) => element.type === BrandDocumentUploadForm);
  expect(uploadForm).toBeDefined();
  expect(uploadForm?.props?.tenantId).toBe("ten_example");
  expect(tree.filter((element) => element.type === "form"
    && element.props?.action === "/api/admin/brand-proposals")).toHaveLength(4);
});

it("shows typed upload provenance and keeps superseded proposals read-only", async () => {
  const row = (await mocks.query()).rows[0];
  mocks.query.mockResolvedValueOnce({
    rows: [{
      ...row,
      source_url: "upload:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      source_kind: "upload",
      file_digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      parser_version: "brand-md-v1",
      proposed_values: {
        displayName: {
          value: "Example Organisation",
          fileDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          uploadedByUserId: "user_example",
          uploadedAt: "2026-09-06T12:00:00.000Z",
        },
      },
      proposal_status: "superseded",
    }],
  });

  const result = await BrandProposalsPage({
    params: Promise.resolve({ tenantId: "ten_example" }),
  });
  expect(textContent(result)).toContain("Uploaded brand.md");
  expect(textContent(result)).toContain("SHA-256");
  expect(textContent(result)).toContain("brand-md-v1");
  expect(textContent(result)).toContain("user_example");
  expect(textContent(result)).toContain("Superseded");
  const provenance = elements(result).find((element) =>
    element.type === "dd" && textContent(element) === "SHA-256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
  expect(provenance?.props?.className).toContain("break-all");
  expect(textContent(result)).not.toContain("Review proposal");
  expect(textContent(result)).not.toContain("Apply");
  expect(textContent(result)).not.toContain("Discard proposal");
});

it("shows locked upload values as rejected evidence without editable controls", async () => {
  const row = (await mocks.query()).rows[0];
  mocks.query.mockResolvedValueOnce({
    rows: [{
      ...row,
      source_url: "upload:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      source_kind: "upload",
      file_digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      parser_version: "brand-md-v1",
      locked_keys: ["colorPrimary"],
      proposed_values: {
        displayName: {
          value: "Example Organisation",
          fileDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          uploadedByUserId: "user_example",
          uploadedAt: "2026-09-06T12:00:00.000Z",
        },
        colorPrimary: {
          value: "#123456",
          fileDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          uploadedByUserId: "user_example",
          uploadedAt: "2026-09-06T12:00:00.000Z",
        },
      },
    }],
  });

  const result = await BrandProposalsPage({
    params: Promise.resolve({ tenantId: "ten_example" }),
  });
  const tree = elements(result);

  expect(textContent(result)).toContain("Rejected: locked by policy");
  expect(tree.some((element) => element.props?.name === "value.displayName")).toBe(true);
  expect(tree.some((element) => element.props?.name === "value.colorPrimary")).toBe(false);
});

it("does not present the current policy version as historical apply evidence", async () => {
  const row = (await mocks.query()).rows[0];
  mocks.query.mockResolvedValueOnce({
    rows: [{
      ...row,
      proposal_status: "applied",
      policy_version: 12,
      reviewed_policy_version: 11,
    }],
  });

  const result = await BrandProposalsPage({
    params: Promise.resolve({ tenantId: "ten_example" }),
  });

  expect(textContent(result)).toContain("Applied to the active tenant brand.");
  expect(textContent(result)).not.toContain("policy version 12");
});

it("keeps an empty pending proposal inactive and discardable but not reviewable", async () => {
  const row = (await mocks.query()).rows[0];
  mocks.query.mockResolvedValueOnce({
    rows: [{
      ...row,
      request_status: "pending",
      proposed_values: {},
    }],
  });

  const result = await BrandProposalsPage({
    params: Promise.resolve({ tenantId: "ten_example" }),
  });

  expect(textContent(result)).toContain("Waiting for seed values");
  expect(textContent(result)).not.toContain("Review proposal");
  expect(textContent(result)).not.toContain("Save edits and require new review");
  expect(textContent(result)).toContain("Discard proposal");
});

it("shows a read-only view when no proposal mutation permissions are granted", async () => {
  mocks.brandProposalTenantContext.mockResolvedValueOnce({
    ok: true,
    context: {
      tenantId: "ten_example",
      session: { permissions: [] },
    },
  });

  const result = await BrandProposalsPage({
    params: Promise.resolve({ tenantId: "ten_example" }),
  });

  expect(textContent(result)).toContain("Example Organisation");
  expect(textContent(result)).not.toContain("Request proposal");
  expect(textContent(result)).not.toContain("Review proposal");
  expect(textContent(result)).not.toContain("Discard proposal");
});

it("does not create edit inputs for unknown legacy value keys", async () => {
  const row = (await mocks.query()).rows[0];
  mocks.query.mockResolvedValueOnce({
    rows: [{
      ...row,
      proposed_values: {
        ...row.proposed_values,
        unknownLegacy: {
          value: "Visible evidence",
          sourceUrl: "https://www.example.test/about",
          retrievedAt: "2026-07-22T08:00:00.000Z",
        },
      },
    }],
  });

  const result = await BrandProposalsPage({
    params: Promise.resolve({ tenantId: "ten_example" }),
  });
  const tree = elements(result);

  expect(textContent(result)).toContain("unknownLegacy");
  expect(tree.some((element) => element.props?.name === "value.unknownLegacy")).toBe(false);
});

it("fails closed before reading proposals without active-tenant authority", async () => {
  mocks.brandProposalTenantContext.mockResolvedValueOnce({
    ok: false,
    reason: "forbidden",
  });

  const denied = await BrandProposalsPage({ params: Promise.resolve({ tenantId: "ten_example" }) });
  expect(denied.props.state).toBe("forbidden");
  expect(mocks.query).not.toHaveBeenCalled();
});
