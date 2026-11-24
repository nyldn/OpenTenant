vi.mock("../../../../lib/rate-limit", () => ({ enforceRateLimit: () => null }));
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

const harness = vi.hoisted(() => ({
  appendWithClient: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  installationOwnerContext: vi.fn(),
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
vi.mock("../../../../lib/installation-owner", () => ({
  installationOwnerContext: harness.installationOwnerContext,
}));
vi.mock("../../../../lib/settings-guard", () => ({ sameOrigin: vi.fn(() => true) }));

import { POST } from "./route";

describe("managed-support policy route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://app.example.test/opentenant");
    harness.installationOwnerContext.mockResolvedValue({
      ok: true,
      context: { authority: { userId: "usr_operator" } },
    });
    harness.connect.mockResolvedValue({ query: harness.clientQuery, release: vi.fn() });
    harness.clientQuery.mockImplementation(async (sql: string) => (
      sql.startsWith("update tenants") ? { rows: [{ tenant_id: "ten_example" }], rowCount: 1 } : { rows: [] }
    ));
    harness.appendWithClient.mockResolvedValue({ sequence: 1 });
  });

  it("updates the selected tenant and appends audit evidence in the same transaction", async () => {
    const response = await POST(new Request("https://app.example.test/api/admin/support-policy", {
      method: "POST",
      body: new URLSearchParams({ tenantId: "ten_example", enabled: "true" }),
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/admin");
    expect(harness.clientQuery).toHaveBeenCalledWith("begin");
    expect(harness.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("returning tenant_id"),
      ["ten_example", true],
    );
    expect(harness.appendWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: "ten_example", action: "support.policy_changed" }),
    );
    expect(harness.clientQuery).toHaveBeenCalledWith("commit");
  });

  it("does not emit policy audit evidence for an unknown tenant", async () => {
    harness.clientQuery.mockImplementation(async (sql: string) => (
      sql.startsWith("update tenants") ? { rows: [], rowCount: 0 } : { rows: [] }
    ));

    const response = await POST(new Request("https://app.example.test/api/admin/support-policy", {
      method: "POST",
      body: new URLSearchParams({ tenantId: "ten_missing", enabled: "true" }),
    }));

    expect(response.status).toBe(404);
    expect(harness.appendWithClient).not.toHaveBeenCalled();
    expect(harness.clientQuery).toHaveBeenCalledWith("rollback");
  });
});
