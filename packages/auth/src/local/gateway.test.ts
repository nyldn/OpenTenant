import { describe, expect, it } from "vitest";
import type { TenantId, UserId } from "../identity";
import { LocalIdentityGateway, localIdentityConfigFromEnv } from "./gateway";

const config = {
  origin: "http://localhost:3000",
  sessionToken: "local-test-session",
  tenantId: "tenant_local" as TenantId,
  userId: "user_local" as UserId,
  email: "developer@example.test",
  displayName: "Local Developer",
  permissions: ["assessment.use", "brain.use"],
};

describe("LocalIdentityGateway", () => {
  it("validates only its local token and binds it to one tenant", async () => {
    const gateway = new LocalIdentityGateway(config);

    await expect(gateway.validateSession("wrong", null)).resolves.toEqual({ status: "invalid" });
    await expect(
      gateway.validateSession(config.sessionToken, "tenant_other" as TenantId),
    ).resolves.toEqual({ status: "tenant_mismatch", userId: config.userId });
    await expect(gateway.validateSession(config.sessionToken, config.tenantId)).resolves.toMatchObject({
      status: "valid",
      session: {
        userId: config.userId,
        activeTenantId: config.tenantId,
        activeRole: "tenant_owner",
        isPlatformAdmin: true,
        permissions: config.permissions,
      },
    });
  });

  it("starts a same-origin local login without putting the token in the URL", async () => {
    const gateway = new LocalIdentityGateway(config);
    const url = await gateway.startLogin({
      tenantId: null,
      returnPath: "/assessment",
      requestUrl: "http://localhost:3000/auth/login",
    });

    expect(url.toString()).toBe("http://localhost:3000/auth/local?return=%2Fassessment");
    expect(url.toString()).not.toContain(config.sessionToken);
  });

  it("lists its single normalized tenant member", async () => {
    const gateway = new LocalIdentityGateway(config);

    await expect(gateway.listTenantMembers(config.tenantId)).resolves.toEqual([
      {
        kind: "membership",
        membershipId: "membership_local",
        userId: config.userId,
        tenantId: config.tenantId,
        email: config.email,
        displayName: config.displayName,
        role: "tenant_owner",
        status: "active",
      },
    ]);
  });

  it("rejects local identity configuration in production", () => {
    expect(() =>
      localIdentityConfigFromEnv({
        NODE_ENV: "production",
        IDENTITY_PROVIDER: "local",
      }),
    ).toThrow("Local identity is disabled in production");
  });

  it("uses explicit, account-free development defaults", () => {
    expect(
      localIdentityConfigFromEnv({
        NODE_ENV: "development",
        IDENTITY_PROVIDER: "local",
      }),
    ).toMatchObject({
      origin: "http://localhost:3000",
      tenantId: "tenant_local",
      userId: "user_local",
      email: "developer@example.test",
      permissions: [],
    });
  });
  it("accepts registry-derived defaults and lets explicit installation configuration replace them", () => {
    expect(localIdentityConfigFromEnv({ IDENTITY_PROVIDER: "local" }, ["sample.use"]).permissions).toEqual(["sample.use"]);
    expect(localIdentityConfigFromEnv({ IDENTITY_PROVIDER: "local", LOCAL_PERMISSIONS: "other.use" }, ["sample.use"]).permissions).toEqual(["other.use"]);
  });

});
