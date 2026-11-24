import { acknowledgedAuthorizationContext, authorizationSyncEnabled, queueEntitlementSync, queueMembershipSync } from "./authz-lifecycle";
import { withTenantMemberMutationLock } from "./member-mutation-lock";
import { identityGateway } from "./identity";
import { installedModules } from "../opentenant-modules";
import { serverConfig } from "./server-config";
/**
 * Module access policy resolution and passcode-grant cookies (server-only).
 *
 * Access mode is configured per tenant per module in the control plane by
 * platform or tenant admins. identity mode requires a validated session;
 * passcode mode grants access through a signed, expiring cookie after
 * server-side passcode verification.
 */
import { createHash, createHmac } from "node:crypto";
import type { IdentitySession, TenantId } from "@opentenant/auth";
import { signModuleAccess, verifyModuleAccess, verifyPasscode } from "@opentenant/security";
import { controlPlanePool } from "./control-plane";

export type ModuleAccessMode = "identity" | "passcode";

export interface ModuleAccessPolicy {
  mode: ModuleAccessMode;
  passcodeHash: string | null;
}

export interface TenantModulePresentation {
  enabled: boolean;
  displayLabel: string | null;
  supportNote: string | null;
}

export interface VerifiedPasscodePrincipal {
  kind: "passcode";
  principalId: string;
  tenantId: string;
  moduleKey: string;
}

export const ACCESS_COOKIE_PREFIX = "opentenant_module_access_";
const GRANT_TTL_MS = 12 * 60 * 60 * 1000; // one working day

function accessSecret(): string {
  const config = serverConfig();
  const secret = config.MODULE_ACCESS_SECRET ??
    (config.NODE_ENV === "production" ? undefined : config.WORKOS_COOKIE_PASSWORD);
  if (!secret) throw new Error("Missing MODULE_ACCESS_SECRET");
  return secret;
}

/**
 * Persistable admission evidence for a passcode attempt. Length prefixes keep
 * the tenant/module binding unambiguous; the server-only key prevents an
 * offline dictionary over low-entropy passcodes.
 */
export function passcodeAdmissionFingerprint(
  tenantId: TenantId,
  moduleKey: string,
  passcode: string,
): string {
  const framed = `${tenantId.length}:${tenantId}${moduleKey.length}:${moduleKey}${passcode.length}:${passcode}`;
  return createHmac("sha256", accessSecret()).update(framed).digest("hex");
}

/** identity is the fail-closed default when no policy row exists. */
export async function moduleAccessPolicy(tenantId: string, moduleKey: string): Promise<ModuleAccessPolicy> {
  const { rows } = await controlPlanePool().query<{ mode: ModuleAccessMode; passcode_hash: string | null }>(
    "select mode, passcode_hash from module_access_policies where tenant_id = $1 and module_key = $2",
    [tenantId, moduleKey],
  );
  const row = rows[0];
  if (!row) return { mode: "identity", passcodeHash: null };
  return { mode: row.mode, passcodeHash: row.passcode_hash };
}

/** Presentation-only module settings; capability grants and access mode live elsewhere. */
export async function tenantModulePresentation(
  tenantId: string,
  moduleKey: string,
): Promise<TenantModulePresentation | null> {
  const { rows } = await controlPlanePool().query<{
    enabled: boolean;
    settings: Record<string, unknown>;
  }>(
    "select enabled, settings from tenant_modules where tenant_id = $1 and module_key = $2",
    [tenantId, moduleKey],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    enabled: row.enabled,
    displayLabel: typeof row.settings.displayLabel === "string" ? row.settings.displayLabel : null,
    supportNote: typeof row.settings.supportNote === "string" ? row.settings.supportNote : null,
  };
}

/**
 * Grants carry a digest of the passcode hash they were issued under; the
 * salted scrypt hash changes on every rotation, so old grants stop verifying.
 */
export function passcodePolicyBinding(passcodeHash: string | null): string {
  if (!passcodeHash) return "";
  return createHash("sha256").update(passcodeHash).digest("base64url").slice(0, 22);
}

export function accessCookieName(moduleKey: string): string {
  return `${ACCESS_COOKIE_PREFIX}${moduleKey}`;
}

export async function verifyModulePasscode(
  tenantId: string,
  moduleKey: string,
  passcode: string,
): Promise<{ granted: true; cookieValue: string } | { granted: false }> {
  const policy = await moduleAccessPolicy(tenantId, moduleKey);
  if (policy.mode !== "passcode" || policy.passcodeHash === null) return { granted: false };
  if (!verifyPasscode(passcode, policy.passcodeHash)) return { granted: false };
  const cookieValue = signModuleAccess(
    {
      tenantId,
      moduleKey,
      policyBinding: passcodePolicyBinding(policy.passcodeHash),
      expiresAt: Date.now() + GRANT_TTL_MS,
    },
    accessSecret(),
  );
  return { granted: true, cookieValue };
}

export function hasValidAccessGrant(
  cookieValue: string | undefined,
  tenantId: string,
  moduleKey: string,
  passcodeHash: string | null,
): boolean {
  return verifiedPasscodePrincipal(cookieValue, tenantId, moduleKey, passcodeHash) !== null;
}

export function verifiedPasscodePrincipal(
  cookieValue: string | undefined,
  tenantId: string,
  moduleKey: string,
  passcodeHash: string | null,
): VerifiedPasscodePrincipal | null {
  if (!cookieValue) return null;
  const policyBinding = passcodePolicyBinding(passcodeHash);
  if (!policyBinding) return null;
  if (!verifyModuleAccess(cookieValue, { tenantId, moduleKey, policyBinding }, accessSecret())) return null;
  return {
    kind: "passcode",
    principalId: `passcode:${moduleKey}`,
    tenantId,
    moduleKey,
  };
}

/** Initialize accepted invitations using live membership under the same lock as
 * settings mutations. Never overwrite an explicit mutation with an eventually
 * consistent provider read or claims.
 */
async function synchronizedAuthorizationContext(session: IdentitySession, tenantId: string, moduleKey: string) {
  return withTenantMemberMutationLock(tenantId as TenantId, async (client) => {
    const members = await identityGateway(client).listTenantMembers(tenantId as TenantId);
    if (members.some(member => member.tenantId !== tenantId)) return null;
    const member = members.find(member => member.kind === "membership" && member.userId === session.userId && member.status === "active");
    if (!member?.userId) return null;
    await queueMembershipSync(client, { tenantId, userId: member.userId, role: member.role, active: true }, { initializeOnly: true });
    await queueEntitlementSync(client, { tenantId, moduleKey });
    return acknowledgedAuthorizationContext(client, { tenantId, userId: member.userId, moduleKey });
  });
}

/** Resolve module policy through the authorization port and live entitlements. */
export async function resolvePermissions(
  session: IdentitySession,
  tenantId: string,
  moduleKey: string,
): Promise<string[]> {
  const { createAuthorization, failClosed } = await import("@opentenant/authz");
  return failClosed(async () => {
    const sameTenant = session.activeTenantId === tenantId;
    if (!sameTenant && !session.isPlatformAdmin) return [];
    if (session.expiresAt.getTime() <= Date.now() || !Number.isFinite(session.expiresAt.getTime())) return [];
    const syncEnabled = authorizationSyncEnabled();
    const synchronized = syncEnabled ? await synchronizedAuthorizationContext(session, tenantId, moduleKey) : null;
    if (syncEnabled && !synchronized) return [];
    const port = await createAuthorization(serverConfig(), {
      loadContext: async () => {
        const { rows } = await controlPlanePool().query<{
          enabled: boolean;
          authorization_manifest: import("@opentenant/authz").AuthorizationContext["manifest"] | null;
        }>(
          `select tm.enabled, mc.authorization_manifest
             from tenant_modules tm join module_catalog mc using (module_key)
            where tm.tenant_id = $1 and tm.module_key = $2`,
          [tenantId, moduleKey],
        );
        const row = rows[0];
        if (!row?.enabled) return null;
        // NULL is an explicit legacy catalog row; all fresh seeds use role maps.
        const manifest = installedModules.get(moduleKey)?.manifest ?? row.authorization_manifest ?? {
          key: moduleKey, version: "legacy", runtime: "remote" as const,
          navigation: [], permissions: [],
        };
        return {
          manifest: synchronized?.manifest ?? manifest, entitled: row.enabled,
          ...(synchronized ? { membershipVersion: synchronized.membershipVersion, moduleVersion: synchronized.moduleVersion } : {}),
          roles: synchronized?.roles ?? (sameTenant ? (session.activeRole ? [session.activeRole] : []) : ["tenant_member" as const]),
          claims: sameTenant ? session.permissions : [],
        };
      },
    });
    return port.listPermissions({ tenantId, userId: session.userId, moduleKey });
  }, []);
}
