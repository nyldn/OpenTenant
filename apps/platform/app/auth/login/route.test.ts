import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startLogin: vi.fn(),
  provider: vi.fn(),
}));

vi.mock("../../../lib/identity", () => ({
  identityGateway: () => ({ startLogin: mocks.startLogin }),
  identityProviderFromEnv: mocks.provider,
  LOGIN_NONCE_COOKIE: "opentenant_login_nonce",
}));

import { GET } from "./route";

describe("auth login route", () => {
  beforeEach(() => {
    mocks.startLogin.mockReset();
    mocks.provider.mockReset();
    mocks.provider.mockReturnValue("clerk");
  });

  it("starts provider login with a sanitized same-origin return path", async () => {
    mocks.startLogin.mockResolvedValue(new URL("https://tenant.example.test/sign-in?redirect_url=%2Fsettings"));

    const response = await GET(new Request("https://tenant.example.test/auth/login?return=/settings"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://tenant.example.test/sign-in?redirect_url=%2Fsettings");
    expect(mocks.startLogin).toHaveBeenCalledWith({
      tenantId: null,
      returnPath: "/settings",
      requestUrl: "https://tenant.example.test/auth/login?return=/settings",
    });
  });

  it.each(["//host.example/path", "https://host.example/path", "/\\host.example/path", "/\t/host.example"])(
    "rejects unsafe return target %s",
    async (target) => {
      mocks.startLogin.mockResolvedValue(new URL("https://tenant.example.test/sign-in?redirect_url=%2F"));

      await GET(new Request(`https://tenant.example.test/auth/login?return=${encodeURIComponent(target)}`));

      expect(mocks.startLogin).toHaveBeenCalledWith(expect.objectContaining({ returnPath: "/" }));
    },
  );

  it("binds WorkOS state to a browser nonce cookie", async () => {
    mocks.provider.mockReturnValue("workos");
    mocks.startLogin.mockResolvedValue(new URL("https://login.example.test/authorize"));

    const response = await GET(new Request("https://tenant.example.test/auth/login?return=/settings"));

    const [request] = mocks.startLogin.mock.calls[0] as [{ stateNonce?: string }];
    expect(request.stateNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`opentenant_login_nonce=${request.stateNonce}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/auth/callback");
  });
});
