import { LocalIdentityGateway, type TenantId, type UserId } from "@opentenant/auth";
import { identityGatewayContract } from "./identity-conformance";
import { providerFixture } from "./identity-fixtures";
const tenantId = "tenant_a" as TenantId;
const otherTenantId = "tenant_b" as TenantId;
const userId = "user_internal" as UserId;
const token = "synthetic-session";

identityGatewayContract("WorkOS", () => providerFixture("workos"));
identityGatewayContract("Clerk", () => providerFixture("clerk"));
identityGatewayContract("Local", () => ({
  gateway: new LocalIdentityGateway({ origin: "http://localhost:3000", sessionToken: token, tenantId, userId, email: "member@example.test", displayName: "Member", permissions: [] }),
  tenantId, otherTenantId, userId, token, mutable: false, expectedMembershipCount: 1, expectedMemberCount: 1,
  failProvider() {}, foreignSubject() {}, ambiguousMembership() {}, pageReads: [],
}));
