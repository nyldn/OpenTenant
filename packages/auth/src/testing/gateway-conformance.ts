import { describe, expect, it } from "vitest";
import type {
  IdentityGateway,
  IdentitySession,
  TenantId,
} from "../identity";

export type GatewayConformanceScenario =
  | "authenticated"
  | "expired"
  | "invalid"
  | "impersonated"
  | "missing_membership"
  | "inactive_membership"
  | "logout";

export interface GatewayConformanceFixture {
  gateway: IdentityGateway;
  tenantId: TenantId;
  token: string;
  expectedSession: IdentitySession;
  revokedSessionTokens: string[];
}

export function identityGatewayConformance(
  provider: string,
  createFixture: (scenario: GatewayConformanceScenario) => GatewayConformanceFixture,
): void {
  describe(`${provider} identity gateway conformance`, () => {
    it("normalizes an authenticated tenant session", async () => {
      const fixture = createFixture("authenticated");

      await expect(
        fixture.gateway.validateSession(fixture.token, fixture.tenantId),
      ).resolves.toEqual({ status: "valid", session: fixture.expectedSession });
    });

    it.each([
      ["expired", { status: "expired" }],
      ["invalid", { status: "invalid" }],
      ["impersonated", { status: "invalid" }],
      ["missing_membership", { status: "invalid" }],
      ["inactive_membership", { status: "invalid" }],
    ] as const)("fails closed for %s sessions", async (scenario, expected) => {
      const fixture = createFixture(scenario);

      await expect(
        fixture.gateway.validateSession(fixture.token, fixture.tenantId),
      ).resolves.toEqual(expected);
    });

    it("revokes logout through the provider boundary", async () => {
      const fixture = createFixture("logout");

      await fixture.gateway.logout(fixture.token);

      expect(fixture.revokedSessionTokens).toEqual([fixture.token]);
    });
  });
}
