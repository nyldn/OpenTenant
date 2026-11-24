import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantId } from "@opentenant/auth";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  auth: vi.fn(),
  usesClerkIdentity: vi.fn(),
  validateSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("./identity", () => ({
  SESSION_COOKIE: "opentenant_session",
  usesClerkIdentity: mocks.usesClerkIdentity,
  identityGateway: () => ({ validateSession: mocks.validateSession }),
}));

import { currentSession } from "./session";

const tenantId = "tenant_expected" as TenantId;
const normalizedSession = {
  userId: "user_internal",
  email: "member@example.test",
  displayName: null,
  activeTenantId: tenantId,
  activeRole: "tenant_member" as const,
  permissions: [],
  isPlatformAdmin: false,
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
};

describe("currentSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockResolvedValue({ status: "valid", session: normalizedSession });
    mocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) => name === "opentenant_session" ? { value: "cookie-token" } : undefined),
    });
  });

  it("uses only the platform cookie for local and WorkOS deployments", async () => {
    mocks.usesClerkIdentity.mockReturnValue(false);

    await expect(currentSession(tenantId)).resolves.toEqual(normalizedSession);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.validateSession).toHaveBeenCalledWith("cookie-token", tenantId);
  });

  it("uses Clerk auth and getToken without reading the platform cookie", async () => {
    const getToken = vi.fn().mockResolvedValue("clerk-token");
    mocks.usesClerkIdentity.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ isAuthenticated: true, getToken });

    await expect(currentSession(tenantId)).resolves.toEqual(normalizedSession);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledOnce();
    expect(mocks.validateSession).toHaveBeenCalledWith("clerk-token", tenantId);
  });

  it("returns null for an anonymous Clerk request", async () => {
    mocks.usesClerkIdentity.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ isAuthenticated: false, getToken: vi.fn() });

    await expect(currentSession(tenantId)).resolves.toBeNull();
    expect(mocks.validateSession).not.toHaveBeenCalled();
  });

  it("returns null when the credential is valid for another tenant", async () => {
    mocks.usesClerkIdentity.mockReturnValue(false);
    mocks.validateSession.mockResolvedValue({
      status: "tenant_mismatch",
      userId: "user_internal",
    });

    await expect(currentSession(tenantId)).resolves.toBeNull();
    expect(mocks.validateSession).toHaveBeenCalledWith("cookie-token", tenantId);
  });
});
