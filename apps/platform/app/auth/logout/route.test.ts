import { installedModules } from "../../../opentenant-modules";
import { accessCookieName } from "../../../lib/module-access";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  betterLogout: vi.fn(),
  provider: vi.fn(),
  logout: vi.fn(),
  readSessionCookie: vi.fn(),
  auth: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("../../api/auth/better-auth/[...all]/route", () => ({ POST: mocks.betterLogout }));
vi.mock("../../../lib/identity", () => ({
  identityGateway: () => ({ logout: mocks.logout }),
  identityProviderFromEnv: mocks.provider,
  readSessionCookie: mocks.readSessionCookie,
  SESSION_COOKIE: "opentenant_session",
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));

import { GET, POST } from "./route";

describe("auth logout route", () => {
  beforeEach(() => {
    mocks.provider.mockReset();
    mocks.logout.mockReset();
    mocks.readSessionCookie.mockReset();
    mocks.auth.mockReset();
    mocks.getToken.mockReset();
  });

  it("uses the canonical Better Auth sign-out path and forwards origin and cookies", async () => {
    mocks.provider.mockReturnValue("better-auth"); mocks.betterLogout.mockResolvedValue(new Response(null, { status: 303 }));
    expect((await POST(new Request("http://localhost:3000/auth/logout", { method: "POST", headers: { origin: "http://localhost:3000", cookie: "opentenant_session=signed" } }))).status).toBe(303);
    const forwarded = mocks.betterLogout.mock.calls.at(-1)![0] as Request;
    expect(new URL(forwarded.url).pathname).toBe("/api/auth/better-auth/sign-out");
    expect(forwarded.headers.get("origin")).toBe("http://localhost:3000"); expect(forwarded.headers.get("cookie")).toBe("opentenant_session=signed");
  });

  it("revokes and clears the provider cookie for WorkOS", async () => {
    mocks.provider.mockReturnValue("workos");
    mocks.readSessionCookie.mockReturnValue("sealed-session");
    mocks.logout.mockResolvedValue(undefined);

    const response = await POST(new Request("https://tenant.example.test/auth/logout", { method: "POST" }));

    expect(mocks.logout).toHaveBeenCalledWith("sealed-session");
    expect(response.headers.get("set-cookie")).toContain("opentenant_session=");
    for (const definition of installedModules.modules) expect(response.headers.get("set-cookie")).toContain(`${accessCookieName(definition.manifest.key)}=`);
  });

  it("clears the non-Secure local cookie on localhost", async () => {
    mocks.provider.mockReturnValue("local");
    mocks.readSessionCookie.mockReturnValue("local-session");
    mocks.logout.mockResolvedValue(undefined);

    const response = await POST(new Request("http://localhost:3000/auth/logout", { method: "POST" }));
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(mocks.logout).toHaveBeenCalledWith("local-session");
    expect(cookie).toContain("opentenant_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    expect(cookie).not.toContain("opentenant_session=; Path=/; HttpOnly; Secure;");
  });

  it("uses the native Clerk credential without manipulating the provider cookie", async () => {
    mocks.provider.mockReturnValue("clerk");
    mocks.getToken.mockResolvedValue("clerk-token");
    mocks.auth.mockResolvedValue({ isAuthenticated: true, getToken: mocks.getToken });
    mocks.logout.mockRejectedValue(new Error("provider detail must not escape"));

    const response = await POST(new Request("https://tenant.example.test/auth/logout", { method: "POST" }));

    expect(response.status).toBe(302);
    expect(mocks.logout).toHaveBeenCalledWith("clerk-token");
    expect(mocks.readSessionCookie).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).not.toContain("opentenant_session=");
    for (const definition of installedModules.modules) expect(response.headers.get("set-cookie")).toContain(`${accessCookieName(definition.manifest.key)}=`);
    expect(await response.text()).toBe("");
  });

  it("clears app-owned access after native Clerk sign-out", () => {
    mocks.provider.mockReturnValue("clerk");

    const response = GET();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    for (const definition of installedModules.modules) expect(response.headers.get("set-cookie")).toContain(`${accessCookieName(definition.manifest.key)}=`);
    expect(response.headers.get("set-cookie")).not.toContain("opentenant_session=");
  });

  it("does not expose the Clerk completion endpoint to other providers", async () => {
    mocks.provider.mockReturnValue("workos");

    const response = GET();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });
});
