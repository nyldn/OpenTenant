import { installedModules } from "../opentenant-modules";
import { cookies } from "next/headers";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { currentTenant } from "./tenant";
import { currentSession } from "./session";
import { nativeModuleEnabled } from "./module-registry";
import { resolvePermissions, accessCookieName } from "./module-access";
import { resolveModuleAccess } from "./module-access-gate";
import { unavailableTenantContext, sameOrigin, auditActor } from "./settings-guard";
import { brandForTenant } from "./brand";
import { serverConfig } from "./server-config";
import { withTenantDb } from "./tenant-db";
import { modelRouter } from "./model-router";
import { audit } from "./audit";
import { enforceMutationRateLimit } from "./settings-rate-limit";
import { readBoundedForm } from "./bounded-body";
import { admitPlatformRequest, releasePlatformAdmission } from "./admission";
export const moduleServices: ModuleHostServices = {
  cookies, currentTenant, currentSession, nativeModuleEnabled, resolvePermissions,
  accessCookieName, resolveModuleAccess, unavailableTenantContext, brandForTenant,
  serverConfig: () => ({}), withTenantDb, modelRouter, sameOrigin, auditActor, audit,
  enforceMutationRateLimit, readBoundedForm, admitPlatformRequest, releasePlatformAdmission,
};

/** Share only the selected module's declared configuration, never the full server config. */
export function moduleServicesFor(moduleKey: string): ModuleHostServices {
  const keys = installedModules.get(moduleKey)?.environmentKeys ?? [];
  return { ...moduleServices, serverConfig: () => {
    const config = serverConfig(undefined, keys) as Readonly<Record<string, string | undefined>>;
    return Object.fromEntries(keys.map(key => [key, config[key]]));
  } };
}
