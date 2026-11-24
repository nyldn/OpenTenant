import { ClerkIdentityGateway, WorkOSIdentityGateway, type AccountLinkStore, type MembershipId, type OwnedExternalMembershipRef, type TenantId, type UserId, type WorkOSPort, type ClerkPort } from "@opentenant/auth";
import type { IdentityContractFixture } from "./identity-conformance";

const otherTenantId = "tenant_b" as TenantId;
const userId = "user_internal" as UserId;
const token = "synthetic-session";

export function providerFixture(provider: "workos" | "clerk", tenantId: TenantId = "tenant_a" as TenantId): IdentityContractFixture {
  const role = (value: string) => provider === "clerk" ? `org:${value === "member" ? "member" : value.replaceAll("-", "_")}` : value;
  let failed = false;
  let foreign = false;
  let ambiguous = false;
  const pageReads: string[] = [];
  const memberships = Array.from({ length: 3 }, (_, i) => ({ externalMembershipId: `external_${i}`, externalSubject: "subject", externalOrganizationId: i === 2 ? "org_b" : "org_a", role: role("member"), status: "active" as const, email: `member${i}@example.test`, displayName: null }));
  const invitations: Array<{ externalInvitationId: string; email: string; role: string; status: "pending" }> = [];
  const refs = new Map<MembershipId, OwnedExternalMembershipRef>();
  const users = new Map<string, UserId>();
  const check = () => { if (failed) throw Object.assign(new Error("secret-canary Bearer synthetic"), { cause: "secret-canary" }); };
  const accounts: AccountLinkStore = {
    async userIdForExternalSubject(subject) {
      // Yield before the atomic lookup, exercising concurrent first links.
      await Promise.resolve();
      if (!users.has(subject)) users.set(subject, subject === "subject" ? userId : `internal_${subject}` as UserId);
      return users.get(subject)!;
    },
    async externalSubjectForUserId(id) { return id === userId ? "subject" : null; },
    async membershipIdForExternalRef(ref, context) {
      await Promise.resolve();
      const id = `internal_${ref.kind}_${ref.externalId}` as MembershipId;
      refs.set(id, { ...ref, ...context } as OwnedExternalMembershipRef);
      return id;
    },
    async externalRefForMembershipId(id) { return refs.get(id) ?? null; },
    async replaceExternalRefForMembershipId(id, current, replacement) {
      const ref = refs.get(id);
      if (!ref || ref.externalId !== current.externalId) throw new Error("link conflict");
      refs.set(id, { ...ref, ...replacement } as OwnedExternalMembershipRef);
    },
    async isPlatformAdmin() { return false; },
  };
  const orgs = {
    async tenantForExternalOrganization(org: string) { return org === "org_a" ? tenantId : org === "org_b" ? otherTenantId : null; },
    async externalOrganizationForTenant(id: TenantId) { return id === tenantId ? "org_a" : id === otherTenantId ? "org_b" : null; },
  };
  const port = {
    async authenticateSession(value: string) {
      check();
      return value !== token ? { status: "invalid" as const } : { status: "authenticated" as const, session: { externalSessionId: "external_session", externalSubject: "subject", email: "member@example.test", displayName: null, externalOrganizationId: "org_a", impersonated: false, role: role("member"), permissions: [], expiresAt: new Date("2099-01-01") } };
    },
    async listMembershipsForUser() {
      check();
      // WorkOS/Clerk ports promise complete arrays. Fake a paged data source.
      const records = foreign ? memberships.map(m => ({ ...m, externalSubject: "other" })) : memberships;
      pageReads.push("page:1", "page:2");
      return [...records.slice(0, 1), ...records.slice(1), ...(ambiguous ? [records[0]!] : [])];
    },
    async listMembershipsForOrganization(org: string) { check(); return memberships.filter(m => m.externalOrganizationId === org); },
    async listInvitationsForOrganization(org: string) { check(); return org === "org_a" ? invitations : []; },
    async sendInvitation(email: string, _org: string, invitedRole: string) {
      check();
      let invitation = invitations.find(i => i.email === email);
      if (!invitation) { invitation = { externalInvitationId: `invite_${invitations.length}`, email, role: invitedRole, status: "pending" }; invitations.push(invitation); }
      return invitation.externalInvitationId;
    },
    async deleteMembership(idOrOrg: string, subject?: string) {
      check();
      const index = memberships.findIndex(m => subject === undefined ? m.externalMembershipId === idOrOrg : m.externalOrganizationId === idOrOrg && m.externalSubject === subject);
      if (index >= 0) memberships.splice(index, 1);
    },
    async revokeInvitation() {}, async replaceInvitationRole() { return "replacement"; },
    async updateMembershipRole(idOrOrg: string, subjectOrRole: string, nextRole?: string) {
      check();
      const member = memberships.find(m => provider === "workos" ? m.externalMembershipId === idOrOrg : m.externalOrganizationId === idOrOrg && m.externalSubject === subjectOrRole);
      if (!member) throw new Error("Missing membership");
      member.role = nextRole ?? subjectOrRole;
    }, async revokeSession() {},
    async authorizationUrl() { return new URL("http://localhost/sign-in"); },
    async createOrganization() { return "org_created"; }, async deleteOrganization() {},
    async generateAdminPortalLink() { return new URL("http://localhost/portal"); },
  };
  // Use distinct subjects in the directory so Clerk's ownership check is exact.
  memberships[1]!.externalSubject = "subject_second";
  return {
    gateway: provider === "workos" ? new WorkOSIdentityGateway(port as WorkOSPort, orgs, accounts) : new ClerkIdentityGateway(port as ClerkPort, orgs, accounts),
    tenantId, otherTenantId, userId, token, mutable: true,
    expectedMembershipCount: 2, expectedMemberCount: 2,
    failProvider: () => { failed = true; }, foreignSubject: () => { foreign = true; }, ambiguousMembership: () => { ambiguous = true; }, pageReads,
  };
}
