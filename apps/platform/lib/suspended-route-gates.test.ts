import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lifecycle: vi.fn(), session: vi.fn() }));
vi.mock("./tenant", () => ({ currentTenant: async () => null, tenantLifecycleForHost: mocks.lifecycle }));
vi.mock("./session", () => ({ currentSession: mocks.session }));
vi.mock("./managed-support", () => ({ managedSupportContext: vi.fn() }));
import { tenantAdminContext } from "./tenant-admin";
import { enforceRateLimit } from "./rate-limit";
beforeEach(() => { vi.clearAllMocks(); mocks.lifecycle.mockResolvedValue({ status: "suspended" }); });
it("returns 423 from tenant administration before reading identity", async () => {
  const result = await tenantAdminContext();
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response?.status).toBe(423);
  expect(mocks.session).not.toHaveBeenCalled();
});
it("returns 423 from the rate-limit gate before acquiring a limiter", async () => {
  const response = await enforceRateLimit(new Request("https://suspended.example.test/api/settings/branding"), { tenantId: "tenant_synthetic", userId: "user_synthetic", routeClass: "settings" });
  expect(response?.status).toBe(423);
  expect(response?.headers.get("cache-control")).toBe("no-store");
});
