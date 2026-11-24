import type { PoolClient } from "pg";
import type { AuthorizationContext, TenantRole } from "@opentenant/authz";
import { installedModules } from "../opentenant-modules";
import { serverConfig } from "./server-config";
import { controlPlanePool } from "./control-plane";
import { createAuthorization } from "@opentenant/authz";
import { runAuthorizationOutbox } from "./authz-outbox";
import { enqueueAuthorizationChange } from "./authz-outbox";

type Client = Pick<PoolClient, "query">;

/** Published restrictions survive reconciliation. Installed code is the ceiling
 * for both declared permissions and each role's grants.
 */
function permissionSnapshot(manifest: AuthorizationContext["manifest"], installed?: AuthorizationContext["manifest"]): AuthorizationContext["manifest"] {
  const permissions = manifest.permissions.filter(permission => !installed || installed.permissions.includes(permission));
  const rolePermissions = Object.fromEntries((["tenant_owner", "tenant_admin", "tenant_member"] as const).map(role => [role,
    (manifest.rolePermissions?.[role] ?? []).filter(permission => permissions.includes(permission)
      && (!installed || installed.rolePermissions?.[role]?.includes(permission))),
  ]));
  return { key: manifest.key, version: manifest.version, runtime: manifest.runtime, navigation: [], permissions, rolePermissions };
}

/** Default deployments do not read or write outbox tables or mutate the role map. */
export function authorizationSyncEnabled(config: { AUTHZ_PROVIDER?: string; OPENFGA_API_URL?: string; OPENFGA_STORE_ID?: string; OPENFGA_MODEL_ID?: string } = serverConfig()): boolean {
  if (!config.AUTHZ_PROVIDER || config.AUTHZ_PROVIDER === "in-process") return false;
  if (config.AUTHZ_PROVIDER !== "openfga" || !config.OPENFGA_API_URL || !config.OPENFGA_STORE_ID || !config.OPENFGA_MODEL_ID) {
    throw new Error("Invalid authorization configuration");
  }
  return true;
}

/** Run after the identity mutation, on the SAME locked transaction client.
 * An invitation alone grants nothing. Call with active=true only on acceptance.
 */
export async function queueMembershipSync(client: Client, input: {
  tenantId: string; userId: string; role: TenantRole; active: boolean;
}, options: { initializeOnly?: boolean } = {}): Promise<void> {
  if (!authorizationSyncEnabled()) return;
  await enqueueAuthorizationChange(client, input.tenantId, { kind: "membership", userId: input.userId, role: input.role, active: input.active }, options);
}

/** Read the mutation's live entitlement and freeze its permission snapshot.
 * Publication callers must pass the newly reviewed manifest explicitly.
 */
export async function queueEntitlementSync(client: Client, input: {
  tenantId: string; moduleKey: string; manifest?: AuthorizationContext["manifest"];
}): Promise<void> {
  if (!authorizationSyncEnabled()) return;
  const { rows } = await client.query<{ enabled: boolean; authorization_manifest: AuthorizationContext["manifest"] | null }>(
    `select tm.enabled, mc.authorization_manifest from tenant_modules tm join module_catalog mc using (module_key)
     where tm.tenant_id=$1 and tm.module_key=$2 for share of tm, mc`, [input.tenantId, input.moduleKey]);
  const installed = installedModules.get(input.moduleKey)?.manifest;
  const manifest = input.manifest ?? rows[0]?.authorization_manifest ?? installed;
  if (!manifest || manifest.key !== input.moduleKey || manifest.rolePermissions === undefined) throw new Error("Authorization snapshot unavailable");
  await enqueueAuthorizationChange(client, input.tenantId, {
    kind: "entitlement", moduleKey: input.moduleKey, enabled: rows[0]?.enabled === true,
    manifest: permissionSnapshot(manifest, installed),
  });
}

/** Catalog publication must call this inside its transaction, after the update. */
export async function queueManifestPublication(client: Client, manifest: AuthorizationContext["manifest"]): Promise<void> {
  if (!authorizationSyncEnabled()) return;
  const { rows } = await client.query<{ tenant_id: string }>(
    "select tenant_id from tenant_modules where module_key=$1 order by tenant_id", [manifest.key]);
  for (const row of rows) await queueEntitlementSync(client, { tenantId: row.tenant_id, moduleKey: manifest.key, manifest });
}

/** The local desired state is an additional fail-closed gate around OpenFGA.
 * Pending versions, removed members and disabled modules never use old tuples.
 */
export async function acknowledgedAuthorizationContext(client: Client, input: {
  tenantId: string; userId: string; moduleKey: string;
}): Promise<Pick<AuthorizationContext, "roles" | "manifest" | "membershipVersion" | "moduleVersion"> | null> {
  const { rows } = await client.query<{
    membership_version: string; module_version: string;
    membership: { role: TenantRole; active: boolean };
    entitlement: { enabled: boolean; manifest: AuthorizationContext["manifest"] };
  }>(
    `select m.version as membership_version, e.version as module_version, m.payload as membership, e.payload as entitlement
     from authorization_sync_state m join authorization_sync_state e on e.tenant_id=m.tenant_id
     where m.tenant_id=$1 and m.kind='membership' and m.subject=$2 and e.kind='entitlement' and e.subject=$3
       and m.version=m.delivered_version and e.version=e.delivered_version`, [input.tenantId, input.userId, input.moduleKey]);
  const row = rows[0];
  if (!row?.membership.active || !row.entitlement.enabled) return null;
  return { roles: [row.membership.role], manifest: row.entitlement.manifest,
    membershipVersion: row.membership_version, moduleVersion: row.module_version };
}

/** Integrator-owned scheduler entry point. Disabled mode never opens the pool. */
export async function runConfiguredAuthorizationOutbox(tenantId: string) {
  if (!authorizationSyncEnabled()) return { delivered: 0, failed: 0, noop: true };
  const port = await createAuthorization(serverConfig(), { loadContext: async () => null });
  return runAuthorizationOutbox({ pool: controlPlanePool(), tenantId, port });
}
