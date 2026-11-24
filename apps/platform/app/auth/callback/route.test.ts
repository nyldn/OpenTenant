import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: vi.fn(),
  exchange: vi.fn(),
}));

vi.mock("../../../lib/identity", () => ({
  identityProviderFromEnv: mocks.provider,
  SESSION_COOKIE: "opentenant_session",
  LOGIN_NONCE_COOKIE: "opentenant_login_nonce",
}));
vi.mock("@opentenant/auth", async (importOriginal) => ({
  safeReturnPath: (await importOriginal<typeof import("@opentenant/auth")>()).safeReturnPath,
  exchangeCodeForSealedSession: mocks.exchange,
  workOSConfigFromEnv: () => ({ marker: "workos-config" }),
}));

import { GET } from "./route";

const NONCE = "n".repeat(43);

function callback(state: Record<string, unknown>, nonceCookie: string | null): Request {
  const url = new URL("https://tenant.example.test/auth/callback");
  url.searchParams.set("code", "provider-code");
  url.searchParams.set("state", JSON.stringify(state));
  return new Request(url, {
    headers: nonceCookie ? { cookie: `other=1; opentenant_login_nonce=${nonceCookie}` } : {},
  });
}

describe("auth callback route", () => {
  beforeEach(() => {
    mocks.provider.mockReset();
    mocks.exchange.mockReset();
  });

  it("returns a generic 404 before reading callback inputs outside WorkOS", async () => {
    mocks.provider.mockReturnValue("clerk");

    const response = await GET(new Request("https://tenant.example.test/auth/callback?code=provider-code"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("keeps the WorkOS code exchange and session cookie behavior", async () => {
    mocks.provider.mockReturnValue("workos");
    mocks.exchange.mockResolvedValue("sealed-session");

    const response = await GET(callback({ returnPath: "/settings", nonce: NONCE }, NONCE));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/settings");
    expect(response.headers.get("set-cookie")).toContain("opentenant_session=sealed-session");
    expect(response.headers.get("set-cookie")).toContain("opentenant_login_nonce=; Path=/auth/callback");
    expect(mocks.exchange).toHaveBeenCalledWith({ marker: "workos-config" }, "provider-code");
  });

  it.each([
    ["no nonce cookie", { returnPath: "/", nonce: "n".repeat(43) }, null],
    ["no nonce in state", { returnPath: "/" }, "n".repeat(43)],
    ["a mismatched nonce", { returnPath: "/", nonce: "m".repeat(43) }, "n".repeat(43)],
  ])("refuses a planted code with %s", async (_label, state, cookie) => {
    mocks.provider.mockReturnValue("workos");

    const response = await GET(callback(state, cookie));

    expect(response.status).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("collapses a backslash return path to the root", async () => {
    mocks.provider.mockReturnValue("workos");
    mocks.exchange.mockResolvedValue("sealed-session");

    const response = await GET(callback({ returnPath: "/\\evil.example", nonce: NONCE }, NONCE));

    expect(response.headers.get("location")).toBe("/");
  });
});
