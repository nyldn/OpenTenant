/**
 * Narrow port over the WorkOS SDK. Only src/workos/sdk.ts may construct the
 * real implementation; tests inject fakes. Keeping the port this small is
 * what makes a later provider migration a bounded cost (spec 8.4 guardrail).
 */

export interface WorkOSAuthenticatedSession {
  externalSubject: string;
  email: string;
  displayName: string | null;
  /** WorkOS organization id active for this session, if any. */
  externalOrganizationId: string | null;
  /** True when WorkOS marks the session as an impersonation session. */
  impersonated: boolean;
  /** Permission slugs from the provider's RBAC claims; empty when none. */
  permissions: string[];
  expiresAt: Date;
}

export type WorkOSSessionResult =
  | { status: "authenticated"; session: WorkOSAuthenticatedSession }
  | { status: "expired" }
  | { status: "invalid" };

export interface WorkOSOrgMemberRecord {
  externalMembershipId: string;
  externalSubject: string;
  email: string;
  displayName: string | null;
  role: string;
  status: "active" | "pending" | "inactive";
}

export interface WorkOSInvitationRecord {
  externalInvitationId: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
}

export interface WorkOSMembershipRecord {
  externalMembershipId: string;
  externalSubject: string;
  externalOrganizationId: string;
  role: string;
  status: "active" | "pending" | "inactive";
}

/** Admin Portal setup flows a tenant admin may launch (spec 8.3). */
export type AdminPortalIntent = "sso" | "dsync" | "domain_verification";

export interface WorkOSPort {
  /** Creates the provider organization paired with a new OpenTenant tenant. */
  createOrganization(name: string): Promise<string>;
  /** Compensating cleanup when local tenant creation fails. */
  deleteOrganization(externalOrganizationId: string): Promise<void>;
  authenticateSession(sessionToken: string): Promise<WorkOSSessionResult>;
  /**
   * Single-use, short-lived Admin Portal link for an organization. Never
   * email these; redirect the requesting admin immediately.
   */
  generateAdminPortalLink(externalOrganizationId: string, intent: AdminPortalIntent): Promise<URL>;
  listMembershipsForUser(externalSubject: string): Promise<WorkOSMembershipRecord[]>;
  /** Members of an organization, with profile fields for admin display. */
  listMembershipsForOrganization(externalOrganizationId: string): Promise<WorkOSOrgMemberRecord[]>;
  listInvitationsForOrganization(externalOrganizationId: string): Promise<WorkOSInvitationRecord[]>;
  /** Returns the WorkOS invitation id; a membership exists only after acceptance. */
  sendInvitation(email: string, externalOrganizationId: string, role: string): Promise<string>;
  replaceInvitationRole(
    externalOrganizationId: string,
    externalInvitationId: string,
    role: string,
  ): Promise<string>;
  revokeInvitation(externalInvitationId: string): Promise<void>;
  deleteMembership(externalMembershipId: string): Promise<void>;
  updateMembershipRole(externalMembershipId: string, role: string): Promise<void>;
  authorizationUrl(
    externalOrganizationId: string | null,
    returnPath: string,
    stateNonce?: string,
  ): Promise<URL>;
  revokeSession(sessionToken: string): Promise<void>;
}
