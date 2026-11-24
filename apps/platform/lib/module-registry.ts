import { installedModules } from "../opentenant-modules";
import { serverConfig } from "./server-config";
import { PgModuleOwnershipStore } from "@opentenant/database";
import { authorizationSyncEnabled, queueEntitlementSync, queueManifestPublication } from "./authz-lifecycle";
/**
 * Remote module lookup from the control-plane catalog + tenant entitlement
 * (ADR-003). A remote module is served only when the catalog lists it as
 * runtime 'remote' with a URL and the tenant has it enabled.
 */
import {
  isAllowedRemoteModuleUrl,
  parseRemoteModuleHostAllowlist,
} from "@opentenant/platform-core";
import { controlPlanePool, withControlPlaneTransaction } from "./control-plane";

export interface RemoteModule {
  moduleKey: string;
  version: string;
  remoteUrl: string;
}

/**
 * Whether a native module is enabled for a tenant: an explicit tenant row
 * wins; absent one, the catalog's enabled_by_default applies.
 */
export async function nativeModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
  const { rows } = await controlPlanePool().query<{
    enabled: boolean | null;
    enabled_by_default: boolean;
    ownership_scope: "platform" | "installation" | "tenant";
  }>(
    `select tm.enabled, mc.enabled_by_default, mc.ownership_scope
       from module_catalog mc
       left join tenant_modules tm on tm.module_key = mc.module_key and tm.tenant_id = $1
      where mc.module_key = $2
        and mc.runtime = 'native'`,
    [tenantId, moduleKey],
  );
  const definition = installedModules.get(moduleKey);
  const row = rows[0];
  if (!row || definition?.manifest.runtime !== "native") return false;
  if (row.enabled !== null) return row.enabled;
  return row.ownership_scope === "platform" && row.enabled_by_default && definition.catalog.enabledByDefault;
}

export async function enabledRemoteModule(tenantId: string, moduleKey: string): Promise<RemoteModule | null> {
  const { rows } = await controlPlanePool().query<{ module_key: string; version: string; remote_url: string }>(
    `select mc.module_key, mv.version, mv.remote_url
       from module_catalog mc
       join tenant_modules tm on tm.module_key = mc.module_key and tm.tenant_id = $1
       join module_versions mv on mv.module_key = tm.module_key and mv.version = tm.module_version
      where mc.module_key = $2
        and mc.runtime = 'remote'
        and mv.remote_url is not null
        and tm.enabled = true`,
    [tenantId, moduleKey],
  );
  const row = rows[0];
  if (!row) return null;
  const allowedHosts = parseRemoteModuleHostAllowlist(serverConfig().MODULE_REMOTE_HOST_ALLOWLIST);
  if (!isAllowedRemoteModuleUrl(row.remote_url, allowedHosts)) return null;
  return { moduleKey: row.module_key, version: row.version, remoteUrl: row.remote_url };
}

/** Installation-time registration. Call only after control-plane schema migration. */
export async function seedInstalledModuleCatalog(): Promise<void> {
  const { seedModuleCatalog } = await import("@opentenant/platform-core");
  await withControlPlaneTransaction((client) => seedModuleCatalog(installedModules, client, queueManifestPublication));
}

/** Host-bound ownership store. Shared packages never import host configuration. */
export function moduleOwnershipStore(): PgModuleOwnershipStore {
  return new PgModuleOwnershipStore(controlPlanePool(), {
    allowedRemoteHosts: parseRemoteModuleHostAllowlist(serverConfig().MODULE_REMOTE_HOST_ALLOWLIST),
    queueEntitlementSync,
    queueManifestPublication: async (client, manifest) => {
      if (!authorizationSyncEnabled()) return;
      if (!manifest) throw new Error("Reviewed authorization manifest required");
      await queueManifestPublication(client, manifest);
    },
  });
}
