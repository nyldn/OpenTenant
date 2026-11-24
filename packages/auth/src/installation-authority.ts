import type { IdentitySession, UserId } from "./identity";

/** Installation-level permissions are separate from tenant and support grants. */
export const INSTALLATION_PERMISSIONS = [
  "owner.tenant.create",
  "owner.tenant.read",
  "owner.tenant.configure",
  "owner.tenant.suspend",
  "owner.tenant.delete",
  "owner.support.enter",
  "owner.support.configure",
  "owner.support.customer_data.read",
  "owner.support.customer_data.export",
  "owner.support.credential.rotate",
  "owner.support.data.delete",
  "owner.support.billing.manage",
  "owner.support.identity.manage",
  "owner.support.module_grant.manage",
  "owner.support.domain.activate",
  "owner.support.integration.authorize",
  "owner.module.publish_installation",
  "owner.module.assign",
  "owner.helpdesk.queue.read",
  "owner.audit.read",
  "owner.compliance.manage",
] as const;

export type InstallationPermission = (typeof INSTALLATION_PERMISSIONS)[number];

export interface InstallationAuthority {
  readonly kind: "installation_owner";
  readonly userId: UserId;
  readonly permissions: ReadonlyArray<InstallationPermission>;
  /** Compatibility source until installation grants receive their own persistence. */
  readonly source: "legacy_platform_admin";
}

export type InstallationAuthorizationDecision =
  | { allowed: true; authority: InstallationAuthority }
  | {
      allowed: false;
      reason: "missing_installation_authority" | "unknown_installation_permission";
    };

const knownPermissions = new Set<string>(INSTALLATION_PERMISSIONS);
const LEGACY_PLATFORM_ADMIN_PERMISSIONS = [
  "owner.tenant.create",
  "owner.tenant.read",
  "owner.audit.read",
  "owner.support.enter",
  "owner.support.configure",
  "owner.helpdesk.queue.read",
] as const satisfies
  ReadonlyArray<InstallationPermission>;

/**
 * Converts the existing platform-admin bit at one narrow compatibility seam.
 * Tenant roles and tenant/module permissions are deliberately ignored.
 */
export function installationAuthorityForSession(
  session: IdentitySession,
): InstallationAuthority | null {
  if (session.isPlatformAdmin !== true) return null;
  return {
    kind: "installation_owner",
    userId: session.userId,
    permissions: LEGACY_PLATFORM_ADMIN_PERMISSIONS,
    source: "legacy_platform_admin",
  };
}

/** Public fail-closed authorization entry point for installation operations. */
export function authorizeInstallationAction(
  session: IdentitySession,
  permission: InstallationPermission,
): InstallationAuthorizationDecision {
  if (!knownPermissions.has(permission)) {
    return { allowed: false, reason: "unknown_installation_permission" };
  }
  const authority = installationAuthorityForSession(session);
  if (!authority || !authority.permissions.includes(permission)) {
    return { allowed: false, reason: "missing_installation_authority" };
  }
  return { allowed: true, authority };
}
