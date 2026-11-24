vi.mock("../../../../lib/settings-rate-limit", () => ({ enforceMutationRateLimit: () => null }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ tenantAdminContext: vi.fn() }));

vi.mock("../../../../lib/tenant-admin", () => ({ tenantAdminContext: harness.tenantAdminContext }));
vi.mock("../../../../lib/settings-guard", () => ({
  auditActor: vi.fn(),
  sameOrigin: vi.fn(() => true),
}));

import { POST } from "./route";

describe("module access managed-support boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    harness.tenantAdminContext.mockResolvedValue({ ok: false, reason: "forbidden" });
  });

  it("classifies access-mode and passcode mutation as a sensitive action", async () => {
    const response = await POST(new Request("https://tenant.example.test/api/settings/module-access", {
      method: "POST",
      body: new URLSearchParams({ moduleKey: "sample", mode: "passcode", passcode: "example" }),
    }));

    expect(response.status).toBe(403);
    expect(harness.tenantAdminContext).toHaveBeenCalledExactlyOnceWith("module.access.configure");
  });
});
