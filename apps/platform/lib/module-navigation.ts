import type { IdentitySession, TenantId } from "@opentenant/auth";
import { installedModules } from "../opentenant-modules";
import { moduleNavigation, type ResolvedNavigationItem } from "@opentenant/platform-core";
import { enabledRemoteModule, nativeModuleEnabled } from "./module-registry";
import { moduleAccessPolicy, resolvePermissions } from "./module-access";
import { readNavigationOverride } from "./tenant-settings-store";

export async function tenantModuleNavigation(tenantId: string, session: IdentitySession | null) {
  const available = await Promise.all(installedModules.modules.map(async (module) => {
    const key = module.manifest.key;
    const enabled = await moduleEnabled(tenantId, key, module.manifest.runtime);
    if (!enabled) return null;
    const permissions = session ? await resolvePermissions(session, tenantId, key) : [];
    const policy = await moduleAccessPolicy(tenantId, key);
    return { module, permissions, policy };
  }));
  const enabled = available.filter((entry) => entry !== null);
  const overrides = (await Promise.all(installedModules.navigation.map(async (item) => {
    const row = await readNavigationOverride(tenantId, item.id);
    return row ? { tenantId: tenantId as TenantId, itemId: item.id,
      ...(row.label !== null ? { label: row.label } : {}),
      ...(row.group_name !== null ? { group: row.group_name } : {}),
      ...(row.sort_order !== null ? { order: row.sort_order } : {}),
      ...(row.visible !== null ? { visible: row.visible } : {}),
      lockedFields: Array.isArray(row.locked_fields) ? row.locked_fields.filter((field): field is "label" | "group" | "order" | "visible" => ["label", "group", "order", "visible"].includes(field)) : [], version: 1,
    } : null;
  }))).filter((row) => row !== null);
  const navigation = moduleNavigation(installedModules, new Set(enabled.map((entry) => entry.module.manifest.key)),
    new Set(enabled.flatMap((entry) => entry.permissions)), overrides).items.map(hostNavigationItem);

  const headerNavigation = navigation.flatMap((item) => {
    const label = installedModules.navigation.find((entry) => entry.id === item.id)?.headerLabel;
    return label ? [{ ...item, label }] : [];
  });
  return { navigation, headerNavigation, passcodeModules: enabled.filter((entry) => entry.policy.mode === "passcode" && entry.module.permissions.passcode?.length)
    .map((entry) => entry.module) };
}

async function moduleEnabled(tenantId: string, key: string, runtime: string) {
  return runtime === "remote" ? await enabledRemoteModule(tenantId, key) !== null : nativeModuleEnabled(tenantId, key);
}

function hostNavigationItem(item: ResolvedNavigationItem): ResolvedNavigationItem {
  const owner = installedModules.modules.find(module => module.manifest.navigation.some(entry => entry.id === item.id));
  return owner?.manifest.runtime === "remote" ? { ...item, route: `/modules/${owner.manifest.key}` } : item;
}
