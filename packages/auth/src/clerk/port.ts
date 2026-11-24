/** Narrow validated records exposed by the Clerk Backend API boundary. */
export interface ClerkAuthenticatedSession {
  externalSessionId: string;
  externalSubject: string;
  externalOrganizationId: string | null;
  email: string;
  displayName: string | null;
  impersonated: boolean;
  role: string | null;
  permissions: string[];
  expiresAt: Date;
}

export type ClerkSessionResult =
  | { status: "authenticated"; session: ClerkAuthenticatedSession }
  | { status: "expired" }
  | { status: "invalid" };

export interface ClerkMembershipRecord {
  externalMembershipId: string;
  externalSubject: string;
  externalOrganizationId: string;
  role: string;
  status: "active" | "pending" | "inactive";
}

export interface ClerkOrgMemberRecord extends ClerkMembershipRecord {
  email: string;
  displayName: string | null;
}

export interface ClerkInvitationRecord {
  externalInvitationId: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
}

export interface ClerkPort {
  createOrganization(name: string): Promise<string>;
  deleteOrganization(externalOrganizationId: string): Promise<void>;
  authenticateSession(sessionToken: string): Promise<ClerkSessionResult>;
  listMembershipsForUser(externalSubject: string): Promise<ClerkMembershipRecord[]>;
  listMembershipsForOrganization(externalOrganizationId: string): Promise<ClerkOrgMemberRecord[]>;
  listInvitationsForOrganization(externalOrganizationId: string): Promise<ClerkInvitationRecord[]>;
  sendInvitation(email: string, externalOrganizationId: string, role: string): Promise<string>;
  revokeInvitation(externalOrganizationId: string, externalInvitationId: string): Promise<void>;
  replaceInvitationRole(
    externalOrganizationId: string,
    externalInvitationId: string,
    role: string,
  ): Promise<string>;
  deleteMembership(externalOrganizationId: string, externalSubject: string): Promise<void>;
  updateMembershipRole(
    externalOrganizationId: string,
    externalSubject: string,
    role: string,
  ): Promise<void>;
  authorizationUrl(returnPath: string, requestUrl: string): Promise<URL>;
  revokeSession(sessionToken: string): Promise<void>;
}
