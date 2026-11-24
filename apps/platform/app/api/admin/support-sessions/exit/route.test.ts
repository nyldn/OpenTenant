vi.mock("../../../../../lib/rate-limit", () => ({ enforceRateLimit: () => null }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  appendWithClient: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  cookieDelete: vi.fn(),
  currentSession: vi.fn(),
  readToken: vi.fn(),
  revokeWithClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: harness.cookieDelete })),
}));
vi.mock("@opentenant/database", () => ({
  PgAuditStore: class {
    readonly appendWithClient = harness.appendWithClient;
  },
}));
vi.mock("../../../../../lib/session", () => ({ currentSession: harness.currentSession }));
vi.mock("../../../../../lib/settings-guard", () => ({ sameOrigin: vi.fn(() => true) }));
vi.mock("../../../../../lib/support-session-cookie", () => ({
  SUPPORT_SESSION_COOKIE: "opentenant_support",
  supportSessionToken: harness.readToken,
}));
vi.mock("../../../../../lib/support-session-store", () => ({
  supportSessionDatabase: () => ({ connect: harness.connect }),
  supportSessionStore: () => ({ revokeWithClient: harness.revokeWithClient }),
}));

import { POST } from "./route";

describe("managed-support session exit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    harness.currentSession.mockResolvedValue({ userId: "usr_operator" });
    harness.readToken.mockResolvedValue("opaque-token");
    harness.connect.mockResolvedValue({ query: harness.clientQuery, release: vi.fn() });
    harness.clientQuery.mockResolvedValue({ rows: [] });
    harness.revokeWithClient.mockResolvedValue({
      sessionId: "sup_example",
      tenantId: "ten_example",
      reason: "Repair approved tenant configuration",
      reference: null,
    });
    harness.appendWithClient.mockRejectedValue(new Error("synthetic audit failure"));
  });

  it("rolls back revocation when its audit evidence cannot be appended", async () => {
    const response = await POST(new Request("https://tenant.example.test/api/admin/support-sessions/exit", {
      method: "POST",
    }));

    expect(response.status).toBe(500);
    expect(harness.revokeWithClient).toHaveBeenCalledOnce();
    expect(harness.appendWithClient).toHaveBeenCalledOnce();
    expect(harness.clientQuery).toHaveBeenCalledWith("rollback");
    expect(harness.cookieDelete).not.toHaveBeenCalled();
  });

  it("rolls back when the support session cannot be revoked", async () => {
    harness.revokeWithClient.mockResolvedValueOnce(null);

    const response = await POST(new Request("https://tenant.example.test/api/admin/support-sessions/exit", {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    expect(harness.appendWithClient).not.toHaveBeenCalled();
    expect(harness.clientQuery).toHaveBeenCalledWith("rollback");
    expect(harness.clientQuery).not.toHaveBeenCalledWith("commit");
    expect(harness.cookieDelete).not.toHaveBeenCalled();
  });

  it("commits audited revocation before deleting the support cookie", async () => {
    harness.appendWithClient.mockResolvedValueOnce({ sequence: 2 });

    const response = await POST(new Request("https://tenant.example.test/api/admin/support-sessions/exit", {
      method: "POST",
    }));

    expect(response.status).toBe(303);
    expect(harness.clientQuery).toHaveBeenCalledWith("commit");
    expect(harness.cookieDelete).toHaveBeenCalledWith("opentenant_support");
  });
});
