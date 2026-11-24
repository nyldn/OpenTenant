/**
 * Provider-neutral identity contract (architecture spec section 8).
 *
 * The platform owns stable internal identifiers for users, tenants, and
 * memberships. An identity provider (WorkOS first) is authoritative only for
 * authentication and organization-membership lifecycle. Only the provider
 * adapter may import provider SDKs or persist provider object identifiers;
 * everything else in the platform consumes the normalized types below.
 */

/** Application roles, ordered by privilege. Spec section 8.2. */
export type PlatformRole = "platform_admin";
export type TenantRole = "tenant_owner" | "tenant_admin" | "tenant_member";
export type Role = PlatformRole | TenantRole;
export type IdentityProvider = "workos" | "clerk" | "better-auth";

/** Stable internal identifiers. Never provider values. */
export type UserId = string & { readonly __brand: "UserId" };
export type TenantId = string & { readonly __brand: "TenantId" };
export type MembershipId = string & { readonly __brand: "MembershipId" };

/**
 * Maps an internal user to a provider account. The only place provider
 * identifiers appear outside the adapter's own persistence.
 */
export interface IdentityAccountLink {
  userId: UserId;
  provider: IdentityProvider;
  /** Provider subject (external user id). */
  externalSubject: string;
  /** Provider organization id backing the tenant, when applicable. */
  externalOrganizationId: string | null;
  /** Minimum profile for application behavior and audit display. */
  email: string;
  displayName: string | null;
}

export interface TenantMembership {
  membershipId: MembershipId;
  userId: UserId;
  tenantId: TenantId;
  role: TenantRole;
  status: "active" | "invited" | "suspended" | "removed";
}

/** Tenant-scoped directory record safe for platform member administration. */
export interface TenantMember {
  kind: "membership" | "invitation";
  membershipId: MembershipId;
  userId: UserId | null;
  tenantId: TenantId;
  email: string;
  displayName: string | null;
  role: TenantRole;
  status: "active" | "invited" | "suspended";
}

/** Request context required to begin any provider's browser login flow. */
export interface LoginRequest {
  tenantId: TenantId | null;
  returnPath: string;
  requestUrl: string;
  /**
   * Browser-bound nonce echoed through provider state so the callback can
   * refuse a code that this browser did not request (login CSRF).
   */
  stateNonce?: string;
}

/** A validated session, normalized away from any provider session object. */
export interface IdentitySession {
  userId: UserId;
  email: string;
  displayName: string | null;
  /** Tenant resolved for this request's host, verified against provider organization. */
  activeTenantId: TenantId | null;
  /** Role within the active tenant, when a tenant is active. */
  activeRole: TenantRole | null;
  /**
   * Module permission slugs (e.g. "brain.promote") granted by the provider's
   * role configuration for the active tenant. Empty when no tenant is active.
   * Elevated permissions flow only from here (a missing slug is a denial);
   * base `${moduleKey}.use` stays membership-derived so an unconfigured role
   * cannot lock a tenant out of an enabled module.
   */
  permissions: ReadonlyArray<string>;
  /** True only for platform administrators; never implied by tenant membership. */
  isPlatformAdmin: boolean;
  expiresAt: Date;
}

export type SessionValidationResult =
  | { status: "valid"; session: IdentitySession }
  | { status: "expired" }
  | { status: "invalid" }
  /** Provider org and resolved tenant disagree. Callers must fail closed. */
  | { status: "tenant_mismatch"; userId: UserId };

export interface Invitation {
  email: string;
  tenantId: TenantId;
  role: TenantRole;
  invitedBy: UserId;
}

/**
 * The single seam between the platform and any identity provider.
 *
 * Implementations: WorkOSIdentityGateway (work package 2). Contract tests run
 * against a fake implementation without provider SDK objects (spec 16.1).
 */
export interface IdentityGateway {
  /** Validate the inbound session token against the provider and normalize it. */
  validateSession(sessionToken: string, expectedTenantId: TenantId | null): Promise<SessionValidationResult>;

  /** Memberships for a user across tenants, for tenant switching. */
  listMemberships(userId: UserId): Promise<TenantMembership[]>;

  /** Provider-neutral directory for one tenant. */
  listTenantMembers(tenantId: TenantId): Promise<TenantMember[]>;

  /** Invite a user into a tenant with a role. Idempotent per (email, tenant). */
  invite(invitation: Invitation): Promise<MembershipId>;

  /** Remove a membership and revoke the provider-side access it granted. */
  removeMembership(membershipId: MembershipId): Promise<void>;

  /** Update a member's role. Provider group claims never bypass this. */
  setRole(membershipId: MembershipId, role: TenantRole): Promise<void>;

  /** Begin a login for a tenant's configured connection. Returns a redirect URL. */
  startLogin(request: LoginRequest): Promise<URL>;

  /** Terminate the provider session backing this session token. */
  logout(sessionToken: string): Promise<void>;
}
