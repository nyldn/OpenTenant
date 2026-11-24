import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ enforce: vi.fn() }));
vi.mock("./rate-limit", async (original) => ({ ...await original<typeof import("./rate-limit")>(), enforceRateLimit: mocks.enforce }));
import { enforceMutationRateLimit } from "./settings-rate-limit";

describe("shared mutation gate", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.enforce.mockResolvedValue(null); });
  it("binds the budget to the validated context and ignores request body and spoofed identity", async () => {
    const req = new Request("https://example.test/api/settings/members", { method: "POST", headers: { "x-tenant-id": "forged" }, body: "tenantId=forged&userId=forged" });
    await enforceMutationRateLimit(req, { tenantId: "ten_verified", session: { userId: "usr_verified" } });
    expect(mocks.enforce).toHaveBeenCalledWith(req, { tenantId: "ten_verified", userId: "usr_verified", routeClass: "members" });
    expect(req.bodyUsed).toBe(false);
  });
  it("preserves the limiter response and Retry-After", async () => {
    const response = new Response("rate limited", { status: 429, headers: { "Retry-After": "17" } });
    mocks.enforce.mockResolvedValue(response);
    expect(await enforceMutationRateLimit(new Request("https://example.test/api/support/tickets"), { tenantId: "ten_verified", session: { userId: "usr_verified" } })).toBe(response);
  });
});
