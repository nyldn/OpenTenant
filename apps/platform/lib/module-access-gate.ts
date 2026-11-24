import { installedModules } from "../opentenant-modules";
import type { IdentitySession, TenantId } from "@opentenant/auth";
import { currentSession } from "./session";
import { currentTenant } from "./tenant";
import {
  moduleAccessPolicy,
  verifiedPasscodePrincipal,
  type ModuleAccessPolicy,
  type VerifiedPasscodePrincipal,
} from "./module-access";
import { nativeModuleEnabled } from "./module-registry";


export interface ModuleAccessDependencies {
  currentTenant(): Promise<{ tenantId: string } | null>;
  nativeModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean>;
  moduleAccessPolicy(tenantId: string, moduleKey: string): Promise<ModuleAccessPolicy>;
  currentSession(tenantId: TenantId): Promise<IdentitySession | null>;
  verifiedPasscodePrincipal(
    cookieValue: string | undefined,
    tenantId: string,
    moduleKey: string,
    passcodeHash: string | null,
  ): VerifiedPasscodePrincipal | null;
}

export type { ModuleAccessResult } from "@opentenant/platform-core";
import type { ModuleAccessResult } from "@opentenant/platform-core";

const productionDependencies: ModuleAccessDependencies = {
  currentTenant,
  nativeModuleEnabled,
  moduleAccessPolicy,
  currentSession,
  verifiedPasscodePrincipal,
};

export async function resolveModuleAccess(
  moduleKey: string,
  grantCookie: string | undefined,
  dependencies: ModuleAccessDependencies = productionDependencies,
): Promise<ModuleAccessResult> {
  const tenant = await dependencies.currentTenant();
  if (!tenant) return { ok: false, reason: "no_tenant" };
  const tenantId = tenant.tenantId as TenantId;

  if (!await dependencies.nativeModuleEnabled(tenantId, moduleKey)) {
    return { ok: false, reason: "unavailable", tenantId };
  }

  const policy = await dependencies.moduleAccessPolicy(tenantId, moduleKey);
  if (policy.mode === "passcode") {
    if (!installedModules.get(moduleKey)?.permissions.passcode?.length) return { ok: false, reason: "unavailable", tenantId };
    const principal = dependencies.verifiedPasscodePrincipal(
      grantCookie,
      tenantId,
      moduleKey,
      policy.passcodeHash,
    );
    return principal
      ? { ok: true, tenantId, mode: "passcode", principal }
      : { ok: false, reason: "passcode_required", tenantId, mode: "passcode" };
  }

  const session = await dependencies.currentSession(tenantId);
  if (!session) return { ok: false, reason: "anonymous", tenantId, mode: "identity" };
  if (session.activeTenantId !== tenantId || session.expiresAt.getTime() <= Date.now() || !Number.isFinite(session.expiresAt.getTime())) {
    return { ok: false, reason: "forbidden", tenantId, mode: "identity" };
  }
  return {
    ok: true,
    tenantId,
    mode: "identity",
    principal: { kind: "identity", principalId: session.userId, session },
  };
}
