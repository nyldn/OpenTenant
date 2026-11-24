import { describe, expect, it } from "vitest";
import type { IdentityGateway, MembershipId, TenantId, UserId } from "@opentenant/auth";

export interface IdentityContractFixture {
  gateway: IdentityGateway;
  tenantId: TenantId;
  otherTenantId: TenantId;
  userId: UserId;
  token: string;
  /** Local single-user gateways must explicitly reject unsupported mutations. */
  mutable: boolean;
  expectedMembershipCount: number;
  expectedMemberCount: number;
  /** Provider-port fake must throw hostile errors, never contact a network. */
  failProvider(): void | Promise<void>;
  /** Seed a provider response belonging to another subject. */
  foreignSubject(): void | Promise<void>;
  /** Seed conflicting membership records for the active organization. */
  ambiguousMembership(): void | Promise<void>;
  pageReads: string[];
}

/** Register once per adapter. Pagination belongs to ports; all pages must reach the gateway. */
export function identityGatewayContract(name: string, fixture: () => IdentityContractFixture | Promise<IdentityContractFixture>): void {
  describe(`${name} shared IdentityGateway contract`, () => {
    it("validates a session only for its bound tenant", async () => {
      const f = await fixture();
      expect(await f.gateway.validateSession(f.token, f.tenantId)).toMatchObject({ status: "valid", session: { userId: f.userId, activeTenantId: f.tenantId } });
      expect(await f.gateway.validateSession(f.token, f.otherTenantId)).toMatchObject({ status: "tenant_mismatch" });
      expect(await f.gateway.validateSession("invalid-token", f.tenantId)).toEqual({ status: "invalid" });
    });
    it("fails closed for malformed tenant IDs", async () => {
      const f = await fixture();
      for (const id of ["", "tenant_а", "' OR 1=1; --", "tenant_a\u0000"]) {
        expect(await f.gateway.validateSession(f.token, id as TenantId)).toMatchObject({ status: "tenant_mismatch" });
        expect(await f.gateway.listTenantMembers(id as TenantId)).toEqual([]);
      }
    });
    it("lists all memberships across provider pages with stable internal IDs", async () => {
      const f = await fixture();
      const memberships = await f.gateway.listMemberships(f.userId);
      expect(memberships).toHaveLength(f.expectedMembershipCount);
      expect(new Set(memberships.map(m => m.membershipId)).size).toBe(memberships.length);
      expect(await f.gateway.listMemberships(f.userId)).toEqual(memberships);
      expect(await f.gateway.listMemberships("unknown" as UserId)).toEqual([]);
      if (f.mutable) expect(new Set(f.pageReads).size).toBeGreaterThanOrEqual(2);
    });
    it("lists members and invitations only for the requested tenant", async () => {
      const f = await fixture();
      const members = await f.gateway.listTenantMembers(f.tenantId);
      expect(members).toHaveLength(f.expectedMemberCount);
      expect(members.every(m => m.tenantId === f.tenantId)).toBe(true);
      expect(await f.gateway.listTenantMembers("unknown" as TenantId)).toEqual([]);
    });
    it.each(["tenant_admin", "tenant_member"] as const)("invites %s through the normal path or rejects unsupported mutation", async role => {
      const f = await fixture();
      const invitation = { tenantId: f.tenantId, invitedBy: f.userId, email: `${role}@example.test`, role };
      if (!f.mutable) {
        await expect(f.gateway.invite(invitation)).rejects.toThrow("unavailable");
        return;
      }
      const id = await f.gateway.invite(invitation);
      expect(await f.gateway.invite(invitation)).toBe(id);
      expect(await f.gateway.listTenantMembers(f.tenantId)).toContainEqual(expect.objectContaining({ membershipId: id, role, status: "invited" }));
    });
    it("never invites an owner through the normal path", async () => {
      const f = await fixture();
      const before = await f.gateway.listTenantMembers(f.tenantId);
      await expect(f.gateway.invite({ tenantId: f.tenantId, invitedBy: f.userId, email: "owner@example.test", role: "tenant_owner" })).rejects.toThrow();
      expect(await f.gateway.listTenantMembers(f.tenantId)).toEqual(before);
    });
    it("allows explicit owner elevation of an active membership while ordinary owner invites stay blocked", async () => {
      const f = await fixture();
      const member = (await f.gateway.listTenantMembers(f.tenantId)).find(m => m.kind === "membership")!;
      if (!f.mutable) {
        await expect(f.gateway.setRole(member.membershipId, "tenant_owner")).rejects.toThrow("unavailable");
        return;
      }
      await f.gateway.setRole(member.membershipId, "tenant_owner");
      expect(await f.gateway.listTenantMembers(f.tenantId)).toContainEqual(expect.objectContaining({ membershipId: member.membershipId, role: "tenant_owner" }));
      await expect(f.gateway.invite({ tenantId: f.tenantId, invitedBy: f.userId, email: "owner@example.test", role: "tenant_owner" })).rejects.toThrow();
    });
    it("removes a member without affecting another tenant", async () => {
      const f = await fixture();
      const beforeOther = await f.gateway.listTenantMembers(f.otherTenantId);
      const target = (await f.gateway.listTenantMembers(f.tenantId))[0]!;
      if (!f.mutable) await expect(f.gateway.removeMembership(target.membershipId)).rejects.toThrow("unavailable");
      else {
        await f.gateway.removeMembership(target.membershipId);
        expect((await f.gateway.listTenantMembers(f.tenantId)).map(m => m.membershipId)).not.toContain(target.membershipId);
      }
      expect(await f.gateway.listTenantMembers(f.otherTenantId)).toEqual(beforeOther);
      await expect(f.gateway.removeMembership("unknown" as MembershipId)).rejects.toThrow();
    });
    it("converges concurrent account linking on one internal user and membership", async () => {
      const f = await fixture();
      const sessions = await Promise.all(Array.from({ length: 16 }, () => f.gateway.validateSession(f.token, f.tenantId)));
      expect(sessions.every(s => s.status === "valid" && s.session.userId === f.userId)).toBe(true);
      const listings = await Promise.all(Array.from({ length: 16 }, () => f.gateway.listMemberships(f.userId)));
      expect(listings.every(m => JSON.stringify(m) === JSON.stringify(listings[0]))).toBe(true);
    });
    it("rejects provider records for another subject", async () => {
      const f = await fixture(); await f.foreignSubject();
      if (!f.mutable) expect(await f.gateway.listMemberships("unknown" as UserId)).toEqual([]);
      else {
        expect(await f.gateway.validateSession(f.token, f.tenantId)).toEqual({ status: "invalid" });
        expect(await f.gateway.listMemberships(f.userId)).toEqual([]);
      }
    });
    it("rejects ambiguous provider membership evidence", async () => {
      const f = await fixture(); await f.ambiguousMembership();
      expect(await f.gateway.validateSession(f.token, f.tenantId)).toMatchObject({ status: f.mutable ? "invalid" : "valid" });
    });
    it("returns normalized errors without provider secrets or causes", async () => {
      const f = await fixture(); await f.failProvider();
      if (!f.mutable) {
        await expect(f.gateway.invite({ tenantId: f.tenantId, invitedBy: f.userId, email: "a@example.test", role: "tenant_member" })).rejects.toThrow("unavailable");
        return;
      }
      for (const call of [() => f.gateway.validateSession(f.token, f.tenantId), () => f.gateway.listMemberships(f.userId), () => f.gateway.listTenantMembers(f.tenantId), () => f.gateway.invite({ tenantId: f.tenantId, invitedBy: f.userId, email: "a@example.test", role: "tenant_member" })]) {
        const error = await call().catch(e => e);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("Identity provider operation failed");
        expect(error.cause).toBeUndefined();
        expect(JSON.stringify(error)).not.toContain("secret-canary");
      }
    });
  });
}
