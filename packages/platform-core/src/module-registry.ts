import type { ModuleDefinition, ModulePageContext, ModuleRegistry } from "@opentenant/module-sdk";
import { resolveNavigation } from "./resolve-navigation";
import type { NavigationOverride } from "./modules";

export function modulePermissions(module: ModuleDefinition, role: string): readonly string[] {
  return module.manifest.rolePermissions?.[role as keyof NonNullable<typeof module.manifest.rolePermissions>] ?? [];
}

/** Entitlement and permission checks run before any extension renderer. */
export async function dispatchNativeModule(
  registry: ModuleRegistry, path: string, context: ModulePageContext,
  enabled: (key: string) => Promise<boolean>,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "not_found" | "forbidden" }> {
  const match = registry.route(path);
  if (!match || match.module.manifest.runtime !== "native" || !match.route.render) return { ok: false, reason: "not_found" };
  if (!await enabled(match.module.manifest.key) || !context.permissions.has(match.route.requiredPermission)) return { ok: false, reason: "forbidden" };
  return { ok: true, value: await match.route.render({ ...context, params: Object.fromEntries(match.route.path.split("/").flatMap((part, i) => part.startsWith(":") ? [[part.slice(1), path.split("/")[i]!]] : [])) }) };
}

export function moduleNavigation(
  registry: ModuleRegistry, enabledKeys: ReadonlySet<string>, permissions: ReadonlySet<string>,
  overrides: readonly NavigationOverride[] = [],
) {
  return resolveNavigation(registry.modules.filter((module) => enabledKeys.has(module.manifest.key))
    .flatMap((module) => module.manifest.navigation), overrides, permissions);
}

/** Run in the caller's control-plane transaction after schema migrations.
 * Existing identities and immutable version records are never overwritten.
 */
export async function seedModuleCatalog<Client extends {
  query(sql: string, values: unknown[]): Promise<unknown>;
}>(registry: ModuleRegistry, client: Client,
  queueManifestPublication?: (client: Client, manifest: ModuleDefinition["manifest"]) => Promise<void>,
): Promise<void> {
  for (const module of registry.modules) {
    const { manifest, catalog } = module;
    const inserted = await client.query(
      `insert into module_catalog (module_key, version, runtime, enabled_by_default, ownership_scope, authorization_manifest)
       values ($1, $2, $3, $4, 'platform', $5::jsonb)
       on conflict (module_key) do nothing returning authorization_manifest`,
      [manifest.key, manifest.version, manifest.runtime, catalog.enabledByDefault, JSON.stringify(manifest)],
    );
    await client.query(
      `insert into module_versions (module_key, version, artifact_digest, digest_kind)
       select $1, $2, encode(sha256(convert_to($1 || '@' || $2, 'UTF8')), 'hex'), 'legacy_identity'
       where exists (select 1 from module_catalog where module_key = $1 and ownership_scope = 'platform')
       on conflict (module_key, version) do nothing`,
      [manifest.key, manifest.version],
    );
    // Publish only the snapshot actually written. A replay must never replace
    // a previously reviewed restriction with the installed code's grants.
    const rows = (inserted as { rows?: { authorization_manifest: ModuleDefinition["manifest"] }[] } | null | undefined)?.rows;
    if (rows?.[0] && queueManifestPublication) await queueManifestPublication(client, rows[0].authorization_manifest);
  }
}
