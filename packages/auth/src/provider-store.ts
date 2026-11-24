import type { MembershipId, TenantId, UserId } from "./identity";

/** Resolves one provider's tenant-to-organization mappings. */
export interface TenantOrgResolver {
  tenantForExternalOrganization(externalOrganizationId: string): Promise<TenantId | null>;
  externalOrganizationForTenant(tenantId: TenantId): Promise<string | null>;
}

/**
 * Provider object reference behind an internal membership ID. Invitations and
 * memberships stay distinct so revocation cannot target the wrong object.
 */
export type ExternalMembershipRef =
  | { kind: "membership"; externalId: string }
  | { kind: "invitation"; externalId: string };

export type OwnedExternalMembershipRef =
  | (ExternalMembershipRef & { kind: "membership"; tenantId: TenantId; userId: UserId })
  | (ExternalMembershipRef & { kind: "invitation"; tenantId: TenantId; userId: null });

/** Provider-bound persistence for stable internal identity identifiers. */
export interface AccountLinkStore {
  userIdForExternalSubject(
    externalSubject: string,
    email: string,
    displayName: string | null,
  ): Promise<UserId>;
  externalSubjectForUserId(userId: UserId): Promise<string | null>;
  membershipIdForExternalRef(
    ref: ExternalMembershipRef,
    context: { tenantId: TenantId; userId: UserId | null },
  ): Promise<MembershipId>;
  externalRefForMembershipId(membershipId: MembershipId): Promise<OwnedExternalMembershipRef | null>;
  replaceExternalRefForMembershipId(
    membershipId: MembershipId,
    current: ExternalMembershipRef,
    replacement: ExternalMembershipRef,
  ): Promise<void>;
  isPlatformAdmin(userId: UserId): Promise<boolean>;
}
