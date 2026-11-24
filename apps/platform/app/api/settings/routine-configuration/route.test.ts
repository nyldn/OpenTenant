vi.mock("../../../../lib/settings-rate-limit", () => ({ enforceMutationRateLimit: () => null }));
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

const harness = vi.hoisted(() => ({
  appendWithClient: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  tenantAdminContext: vi.fn(),
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
}));
vi.mock("../../../../lib/settings-guard", () => ({
  sameOrigin: vi.fn(() => true),
  auditActor: vi.fn(() => ({ kind: "installation_owner", userId: "usr_operator" })),
}));
vi.mock("../../../../lib/tenant-admin", () => ({ tenantAdminContext: harness.tenantAdminContext }));

import { POST } from "./route";

describe("routine support configuration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://app.example.test/opentenant");
    harness.tenantAdminContext.mockResolvedValue({
      ok: true,
      context: {
        session: { userId: "usr_operator" },
        tenant: { tenantId: "ten_example" },
        managedSupport: { sessionId: "sup_example", reason: "Repair approved tenant configuration" },
        auditActor: { kind: "installation_owner", userId: "usr_operator" },
      },
    });
    harness.connect.mockResolvedValue({ query: harness.clientQuery, release: vi.fn() });
    harness.clientQuery.mockImplementation(async (sql: string) => ({
      rows: sql.trim().startsWith("select") ? [{}] : [],
      rowCount: sql.trim().startsWith("update") ? 1 : null,
    }));
    harness.appendWithClient.mockResolvedValue({ sequence: 1 });
  });

  it("updates metadata on the real tenant domain without changing routing state", async () => {
    const response = await POST(new Request("https://tenant.example.test/api/settings/routine-configuration", {
      method: "POST",
      body: new URLSearchParams({
        area: "domain_metadata",
        resourceKey: "Tenant.Example.Test.",
        displayLabel: "Customer portal",
        verificationNote: "DNS change is scheduled",
      }),
    }));

    expect(response.status).toBe(204);
    expect(harness.tenantAdminContext).toHaveBeenCalledWith("domain.metadata.configure");
    expect(harness.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("update domains set"),
      ["ten_example", "tenant.example.test", true, "Customer portal", true, "DNS change is scheduled"],
    );
    const updateSql = harness.clientQuery.mock.calls.find(([sql]) => String(sql).includes("update domains"))?.[0];
    expect(updateSql).not.toMatch(/verification\s*=|active\s*=/);
  });

  it("updates metadata on the real connection without touching scopes or credentials", async () => {
    const response = await POST(new Request("https://tenant.example.test/api/settings/routine-configuration", {
      method: "POST",
      body: new URLSearchParams({
        area: "integration_metadata",
        resourceKey: "slack",
        displayName: "Support workspace",
        healthNote: "Reconnect after workspace maintenance",
      }),
    }));

    expect(response.status).toBe(204);
    expect(harness.tenantAdminContext).toHaveBeenCalledWith("integration.metadata.configure");
    expect(harness.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("update oauth_token_vault set"),
      ["ten_example", "slack", true, "Support workspace", true, "Reconnect after workspace maintenance"],
    );
    const updateSql = harness.clientQuery.mock.calls.find(([sql]) => String(sql).includes("oauth_token_vault"))?.[0];
    expect(String(updateSql).split(/where/i)[0]).not.toMatch(/encrypted_|scopes\s*=|status\s*=|provider\s*=/);
  });

  it("updates presentation settings on the real tenant module without changing enablement", async () => {
    const response = await POST(new Request("https://tenant.example.test/api/settings/routine-configuration", {
      method: "POST",
      body: new URLSearchParams({
        area: "module_metadata",
        resourceKey: "sample",
        displayLabel: "AI readiness",
        supportNote: "Configured for the leadership team",
      }),
    }));

    expect(response.status).toBe(204);
    expect(harness.tenantAdminContext).toHaveBeenCalledWith("module.settings.configure");
    expect(harness.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("update tenant_modules set"),
      ["ten_example", "sample", true, "AI readiness", true, "Configured for the leadership team"],
    );
    const updateSql = harness.clientQuery.mock.calls.find(([sql]) => String(sql).includes("tenant_modules set"))?.[0];
    expect(String(updateSql).split(/where/i)[0]).not.toMatch(/enabled\s*=/);
  });

  it("rolls back and omits audit evidence when the resource does not exist", async () => {
    harness.clientQuery.mockImplementation(async (sql: string) => ({
      rows: [],
      rowCount: sql.trim().startsWith("update") ? 0 : null,
    }));

    const response = await POST(new Request("https://tenant.example.test/api/settings/routine-configuration", {
      method: "POST",
      body: new URLSearchParams({
        area: "module_metadata",
        resourceKey: "sample",
        displayLabel: "AI readiness",
      }),
    }));

    expect(response.status).toBe(404);
    expect(harness.appendWithClient).not.toHaveBeenCalled();
    expect(harness.clientQuery).toHaveBeenCalledWith("rollback");
    expect(harness.clientQuery).not.toHaveBeenCalledWith("commit");
  });

  it("rejects unknown integration resources before database access", async () => {
    const response = await POST(new Request("https://tenant.example.test/api/settings/routine-configuration", {
      method: "POST",
      body: new URLSearchParams({
        area: "integration_metadata",
        resourceKey: "unknown-provider",
        displayName: "Unsafe",
      }),
    }));

    expect(response.status).toBe(400);
    expect(harness.connect).not.toHaveBeenCalled();
  });

it("returns unchanged after a locked read without a write or audit", async () => {
  harness.clientQuery.mockResolvedValue({ rows: [{ displayLabel: "Same label" }], rowCount: 1 });
  const result = await POST(new Request("https://tenant.example.test/api/settings/routine-configuration", {
    method: "POST", headers: { accept: "application/json" }, body: new URLSearchParams({ area: "module_metadata", resourceKey: "sample", displayLabel: "Same label" }),
  }));
  expect(await result.json()).toEqual({ status: "success", message: "Settings unchanged." });
  expect(harness.appendWithClient).not.toHaveBeenCalled();
  expect(harness.clientQuery.mock.calls.some(([sql]) => String(sql).startsWith("update"))).toBe(false);
});

});
