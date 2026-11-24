vi.mock("../../../../lib/rate-limit", () => ({ enforceRateLimit: () => null }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  audit: vi.fn(),
  appendWithClient: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  cookieSet: vi.fn(),
  create: vi.fn(),
  createWithClient: vi.fn(),
  installationOwnerContext: vi.fn(),
  currentTenant: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: harness.cookieSet })),
}));
vi.mock("@opentenant/database", () => ({
  PgAuditStore: class {
    readonly appendWithClient = harness.appendWithClient;
  },
}));
vi.mock("../../../../lib/audit", () => ({ audit: harness.audit }));
vi.mock("../../../../lib/installation-owner", () => ({
  installationOwnerContext: harness.installationOwnerContext,
}));
vi.mock("../../../../lib/settings-guard", () => ({ sameOrigin: vi.fn(() => true) }));
vi.mock("../../../../lib/tenant", () => ({ currentTenant: harness.currentTenant }));
vi.mock("../../../../lib/support-session-store", () => ({
  supportSessionDatabase: () => ({ connect: harness.connect }),
  supportSessionStore: () => ({
    create: harness.create,
    createWithClient: harness.createWithClient,
  }),
}));

import { POST } from "./route";

describe("managed-support session creation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    harness.installationOwnerContext.mockResolvedValue({
      ok: true,
      context: {
        authority: { userId: "usr_operator" },
      },
    });
    harness.currentTenant.mockResolvedValue({
      tenantId: "ten_example",
      displayName: "Example Organisation",
    });
    harness.connect.mockResolvedValue({
      query: harness.clientQuery,
      release: vi.fn(),
    });
    harness.clientQuery.mockResolvedValue({ rows: [] });
    harness.create.mockResolvedValue({
      token: "opaque-token",
      session: { sessionId: "sup_example", reference: null },
    });
    harness.createWithClient.mockResolvedValue({
      token: "opaque-token",
      session: { sessionId: "sup_example", reference: null },
    });
    harness.appendWithClient.mockRejectedValue(new Error("synthetic audit failure"));
    harness.audit.mockRejectedValue(new Error("synthetic audit failure"));
  });

  it("rolls back session creation when its audit evidence cannot be appended", async () => {
    const response = await POST(new Request("https://tenant.example.test/api/admin/support-sessions", {
      method: "POST",
      body: new URLSearchParams({ reason: "Repair approved tenant configuration" }),
    }));

    expect(response.status).toBe(500);
    expect(harness.createWithClient).toHaveBeenCalledOnce();
    expect(harness.appendWithClient).toHaveBeenCalledOnce();
    expect(harness.clientQuery).toHaveBeenCalledWith("rollback");
    expect(harness.cookieSet).not.toHaveBeenCalled();
  });

  it("rolls back when managed support becomes unavailable during creation", async () => {
    harness.createWithClient.mockResolvedValueOnce(null);

    const response = await POST(new Request("https://tenant.example.test/api/admin/support-sessions", {
      method: "POST",
      body: new URLSearchParams({ reason: "Repair approved tenant configuration" }),
    }));

    expect(response.status).toBe(403);
    expect(harness.appendWithClient).not.toHaveBeenCalled();
    expect(harness.clientQuery).toHaveBeenCalledWith("rollback");
    expect(harness.clientQuery).not.toHaveBeenCalledWith("commit");
    expect(harness.cookieSet).not.toHaveBeenCalled();
  });

  it("commits audit evidence before setting the opaque support cookie", async () => {
    harness.appendWithClient.mockResolvedValueOnce({ sequence: 1 });

    const response = await POST(new Request("https://tenant.example.test/api/admin/support-sessions", {
      method: "POST",
      body: new URLSearchParams({
        reason: "Repair approved tenant configuration",
        reference: "CHG-123",
      }),
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://tenant.example.test/settings");
    expect(harness.clientQuery).toHaveBeenCalledWith("commit");
    expect(harness.cookieSet).toHaveBeenCalledWith(
      expect.any(String),
      "opaque-token",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });
});
