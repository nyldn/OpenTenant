import { describe, expect, it, vi } from "vitest";
import type { TenantId, UserId } from "./identity";
import {
  authenticateDeveloperMcpRequest,
  type DeveloperMcpTenantBinding,
  type DeveloperMcpTenantBindingResolver,
  type DeveloperMcpTokenVerifier,
  type VerifiedDeveloperMcpToken,
} from "./developer-mcp";

const tenantA = "tenant_a" as TenantId;
const tenantB = "tenant_b" as TenantId;
const userA = "user_a" as UserId;

function verifiedToken(
  overrides: Partial<VerifiedDeveloperMcpToken> = {},
): VerifiedDeveloperMcpToken {
  return {
    externalSubject: "workos_user_a",
    externalOrganizationId: "workos_org_a",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    delegatedByExternalSubject: null,
    impersonated: false,
    ...overrides,
  };
}

function harness(
  verification: Awaited<ReturnType<DeveloperMcpTokenVerifier["verify"]>> = {
    status: "valid",
    token: verifiedToken(),
  },
) {
  const verify = vi.fn(async () => verification);
  const resolveActiveBinding = vi.fn(
    async (): Promise<DeveloperMcpTenantBinding | null> => ({
      userId: userA,
      tenantId: tenantA,
      membershipStatus: "active",
    }),
  );
  return {
    verifier: { verify } satisfies DeveloperMcpTokenVerifier,
    bindings: { resolveActiveBinding } satisfies DeveloperMcpTenantBindingResolver,
    verify,
    resolveActiveBinding,
  };
}

describe("Developer MCP authentication boundary", () => {
  it.each([null, "", "Basic abc", "Bearer", "Bearer one two", "Bearer one, Bearer two"])(
    "rejects a missing or malformed authorization header without verification: %s",
    async (authorizationHeader) => {
      const h = harness();

      const result = await authenticateDeveloperMcpRequest(
        { authorizationHeader, expectedTenantId: tenantA },
        h,
      );

      expect(result).toEqual({ status: "unauthorized" });
      expect(h.verify).not.toHaveBeenCalled();
      expect(h.resolveActiveBinding).not.toHaveBeenCalled();
    },
  );

  it("normalizes invalid tokens and verifier failures without resolving a tenant", async () => {
    const invalid = harness({ status: "invalid" });
    const failing = harness();
    failing.verify.mockRejectedValueOnce(new Error("sensitive provider detail"));

    await expect(
      authenticateDeveloperMcpRequest(
        { authorizationHeader: "Bearer invalid.jwt.value", expectedTenantId: tenantA },
        invalid,
      ),
    ).resolves.toEqual({ status: "unauthorized" });
    await expect(
      authenticateDeveloperMcpRequest(
        { authorizationHeader: "Bearer failing.jwt.value", expectedTenantId: tenantA },
        failing,
      ),
    ).resolves.toEqual({ status: "unauthorized" });
    expect(invalid.resolveActiveBinding).not.toHaveBeenCalled();
    expect(failing.resolveActiveBinding).not.toHaveBeenCalled();
  });

  it.each([
    verifiedToken({ externalSubject: "" }),
    verifiedToken({ externalSubject: "   " }),
    verifiedToken({ externalOrganizationId: null }),
    verifiedToken({ externalOrganizationId: "   " }),
    verifiedToken({ delegatedByExternalSubject: "workos_user_delegate" }),
    verifiedToken({ impersonated: true }),
    verifiedToken({ expiresAt: new Date("2000-01-01T00:00:00.000Z") }),
    verifiedToken({ expiresAt: new Date(Number.NaN) }),
  ])("denies unsupported or unbound verified principals", async (token) => {
    const h = harness({ status: "valid", token });

    const result = await authenticateDeveloperMcpRequest(
      { authorizationHeader: "Bearer valid.jwt.value", expectedTenantId: tenantA },
      h,
    );

    expect(result).toEqual({ status: "unauthorized" });
    expect(h.resolveActiveBinding).not.toHaveBeenCalled();
  });

  it("derives internal identity from the verified organization and active binding", async () => {
    const h = harness();

    const result = await authenticateDeveloperMcpRequest(
      { authorizationHeader: "Bearer valid.jwt.value", expectedTenantId: tenantA },
      h,
    );

    expect(h.resolveActiveBinding).toHaveBeenCalledWith({
      externalSubject: "workos_user_a",
      externalOrganizationId: "workos_org_a",
    });
    expect(result).toEqual({
      status: "authenticated",
      principal: { userId: userA, tenantId: tenantA, expiresAt: new Date("2030-01-01T00:00:00.000Z") },
    });
  });

  it("fails closed for absent, failing, or cross-tenant bindings", async () => {
    for (const binding of [
      null,
      { userId: userA, tenantId: tenantB, membershipStatus: "active" },
    ] as const) {
      const h = harness();
      h.resolveActiveBinding.mockResolvedValueOnce(binding);

      await expect(
        authenticateDeveloperMcpRequest(
          { authorizationHeader: "Bearer valid.jwt.value", expectedTenantId: tenantA },
          h,
        ),
      ).resolves.toEqual({ status: "unauthorized" });
    }

    const inactive = harness();
    inactive.resolveActiveBinding.mockResolvedValueOnce({
      userId: userA,
      tenantId: tenantA,
      membershipStatus: "inactive",
    });
    await expect(
      authenticateDeveloperMcpRequest(
        { authorizationHeader: "Bearer valid.jwt.value", expectedTenantId: tenantA },
        inactive,
      ),
    ).resolves.toEqual({ status: "unauthorized" });

    const failing = harness();
    failing.resolveActiveBinding.mockRejectedValueOnce(new Error("database detail"));
    await expect(
      authenticateDeveloperMcpRequest(
        { authorizationHeader: "Bearer valid.jwt.value", expectedTenantId: tenantA },
        failing,
      ),
    ).resolves.toEqual({ status: "unauthorized" });
  });
});
