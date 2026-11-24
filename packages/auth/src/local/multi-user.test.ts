import { expect, it } from "vitest";
import { LocalIdentityGateway, localIdentityConfigFromEnv } from "./gateway";
import type { TenantId, UserId } from "../identity";
const entries = ["alpha", "beta"].map(tenant => ({ token: `token-${tenant}`, tenant, user: `user-${tenant}`, email: `${tenant}@example.test`, name: tenant, role: "tenant_owner" }));
it("binds each local token to its configured tenant and user", async () => {
  const gateway = new LocalIdentityGateway(localIdentityConfigFromEnv({ IDENTITY_PROVIDER: "local", LOCAL_USERS: JSON.stringify(entries) }));
  expect(await gateway.validateSession("token-alpha", "alpha" as TenantId)).toMatchObject({ status: "valid", session: { userId: "user-alpha", isPlatformAdmin: false } });
  expect(await gateway.validateSession("token-alpha", "beta" as TenantId)).toMatchObject({ status: "tenant_mismatch" });
  expect(await gateway.validateSession("forged", null)).toEqual({ status: "invalid" });
  expect(await gateway.listMemberships("user-beta" as UserId)).toMatchObject([{ tenantId: "beta" }]);
});
it("rejects malformed, duplicated and production local user configuration", () => {
  for (const value of ["invalid", "[]", JSON.stringify([entries[0], entries[0]]), JSON.stringify([{ ...entries[0], name: "bad\u0000name" }]), JSON.stringify([entries[0], { ...entries[0], token: "different-token", role: "tenant_admin" }])]) expect(() => localIdentityConfigFromEnv({ IDENTITY_PROVIDER: "local", LOCAL_USERS: value })).toThrow("LOCAL_USERS");
  expect(() => localIdentityConfigFromEnv({ NODE_ENV: "production", IDENTITY_PROVIDER: "local", LOCAL_USERS: JSON.stringify(entries) })).toThrow("production");
});
it("represents installation authority and users without memberships explicitly", async () => {
  const users = [
    { ...entries[0], tenant: null, role: null, isPlatformAdmin: true },
    { ...entries[1], tenant: null, role: null },
  ];
  const gateway = new LocalIdentityGateway(localIdentityConfigFromEnv({ IDENTITY_PROVIDER: "local", LOCAL_USERS: JSON.stringify(users) }, ["sensitive.permission"]));
  expect(await gateway.validateSession("token-alpha", null)).toMatchObject({ status: "valid", session: { activeTenantId: null, activeRole: null, isPlatformAdmin: true, permissions: [] } });
  expect(await gateway.validateSession("token-beta", null)).toMatchObject({ status: "valid", session: { isPlatformAdmin: false } });
  expect(await gateway.listMemberships("user-alpha" as UserId)).toEqual([]);
  expect(await gateway.validateSession("token-alpha", "alpha" as TenantId)).toMatchObject({ status: "tenant_mismatch" });
});
it("uses persona permissions without granting a member the owner's permissions", async () => {
  const gateway = new LocalIdentityGateway(localIdentityConfigFromEnv({ IDENTITY_PROVIDER: "local", LOCAL_USERS: JSON.stringify([{ ...entries[0], role: "tenant_member", permissions: ["support.ticket.read_own"] }]) }, ["support.admin"]));
  expect(await gateway.validateSession("token-alpha", null)).toMatchObject({ status: "valid", session: { permissions: ["support.ticket.read_own"] } });
  for (const entry of [{ ...entries[0], tenant: null }, { ...entries[0], isPlatformAdmin: "true" }, { ...entries[0], permissions: [false] }]) {
    expect(() => localIdentityConfigFromEnv({ IDENTITY_PROVIDER: "local", LOCAL_USERS: JSON.stringify([entry]) })).toThrow("LOCAL_USERS");
  }
});
