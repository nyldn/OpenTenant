// SPDX-License-Identifier: Apache-2.0
import {
  OpenFgaClient, CredentialsMethod, ConsistencyPreference,
  ClientWriteRequestOnDuplicateWrites, ClientWriteRequestOnMissingDeletes,
} from "@openfga/sdk";
import type { TupleKey } from "@openfga/sdk";
import type { AuthorizationContext, AuthorizationOptions, AuthorizationPort, CheckRequest, PermissionRequest, RelationshipRequest } from "../port";
import { TENANT_ROLES } from "../port";
import { failClosed, permissionsFor, validRelationships, validRequest } from "../policy";

export interface OpenFgaConfig { apiUrl: string; storeId: string; authorizationModelId: string; apiToken?: string }
// Length-independent framing: identifiers exclude tildes. All member/module/
// permission identities include the tenant, even when user IDs are shared.
const tenantObject = (tenantId: string) => `tenant:${tenantId}`;
const memberObject = (tenantId: string, userId: string, version?: string) => `member:${tenantId}~${userId}${version ? `~${version}` : ""}`;
const moduleObject = (tenantId: string, moduleKey: string, version?: string) => `module:${tenantId}~${moduleKey}${version ? `~${version}` : ""}`;
const permissionObject = (tenantId: string, permission: string, version?: string) => `permission:${tenantId}~${permission}${version ? `~${version}` : ""}`;

export class OpenFgaAuthorization implements AuthorizationPort {
  private readonly client: Pick<OpenFgaClient, "write" | "check">;
  constructor(config: OpenFgaConfig, private readonly options: AuthorizationOptions, client?: Pick<OpenFgaClient, "write" | "check">) {
    const url = new URL(config.apiUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(config.storeId) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(config.authorizationModelId)) {
      throw new Error("Invalid OpenFGA configuration");
    }
    this.client = client ?? new OpenFgaClient({
      apiUrl: config.apiUrl, storeId: config.storeId, authorizationModelId: config.authorizationModelId,
      retryParams: { maxRetry: 0 }, baseOptions: { timeout: options.timeoutMs ?? 1500 },
      ...(config.apiToken ? { credentials: { method: CredentialsMethod.ApiToken, config: { token: config.apiToken } } } : {}),
    });
  }
  private async allowed(request: PermissionRequest, permission: string, context: AuthorizationContext | null): Promise<boolean> {
    const response = await this.client.check({
      user: memberObject(request.tenantId, request.userId, context?.membershipVersion), relation: "granted",
      object: permissionObject(request.tenantId, permission, context?.moduleVersion),
    }, { consistency: ConsistencyPreference.HigherConsistency });
    return response.allowed === true;
  }
  listPermissions(request: PermissionRequest): Promise<string[]> {
    return failClosed(async () => {
      if (!validRequest(request)) return [];
      const context = await this.options.loadContext(request);
      const candidates = permissionsFor(context, request.moduleKey);
      // A single failed check invalidates the entire result, including base use.
      const allowed = await Promise.all(candidates.map((p) => this.allowed(request, p, context)));
      return candidates.filter((_, index) => allowed[index]);
    }, [], this.options.timeoutMs);
  }
  check(request: CheckRequest): Promise<boolean> {
    return failClosed(async () => {
      if (request.tenantId !== request.object.tenantId) return false;
      return (await this.listPermissions({ ...request, moduleKey: request.object.moduleKey })).includes(request.relation);
    }, false, this.options.timeoutMs);
  }
  private async tuples(request: RelationshipRequest): Promise<TupleKey[]> {
    const tuples: TupleKey[] = [];
    for (const r of request.relationships) {
      const tenant = tenantObject(request.tenantId);
      if (r.kind === "membership") {
        tuples.push({ user: memberObject(request.tenantId, r.userId, r.version), relation: r.role, object: tenant });
        continue;
      }
      const context = r.manifest ? null : await this.options.loadContext({ tenantId: request.tenantId, userId: "authz_sync", moduleKey: r.moduleKey });
      const manifest = r.manifest ?? context?.manifest;
      if (!manifest || manifest.key !== r.moduleKey || manifest.rolePermissions === undefined) {
        throw new Error("OpenFGA sync requires a mapped manifest");
      }
      const module = moduleObject(request.tenantId, r.moduleKey, r.version);
      tuples.push({ user: tenant, relation: "tenant", object: module });
      tuples.push({ user: `${tenant}#active`, relation: "entitled", object: module });
      for (const permission of new Set(manifest.permissions)) {
        if (!permission.startsWith(`${r.moduleKey}.`) || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*)+$/u.test(permission)) continue;
        const object = permissionObject(request.tenantId, permission, r.version);
        tuples.push({ user: module, relation: "module", object });
        for (const role of TENANT_ROLES) {
          if (manifest.rolePermissions[role]?.includes(permission)) {
            tuples.push({ user: `${tenant}#${role}`, relation: "grantee", object });
          }
        }
      }
    }
    return [...new Map(tuples.map((t) => [JSON.stringify(t), t])).values()];
  }
  private mutate(request: RelationshipRequest, remove: boolean): Promise<boolean> {
    return failClosed(async () => {
      if (!validRelationships(request)) return false;
      // Revocation deletes the entitlement gate only. This remains correct after
      // manifest changes and does not need to reconstruct historical grant tuples.
      const tuples = remove ? request.relationships.map((r): TupleKey => r.kind === "membership"
        ? { user: memberObject(request.tenantId, r.userId, r.version), relation: r.role, object: tenantObject(request.tenantId) }
        : { user: `${tenantObject(request.tenantId)}#active`, relation: "entitled", object: moduleObject(request.tenantId, r.moduleKey, r.version) })
        : await this.tuples(request);
      if (!tuples.length) return true;
      // Bound provider requests. The entitlement gate is written last, after
      // every permission tuple. Lifecycle checks also require local acknowledgement.
      const ordered = remove ? tuples : tuples.filter(t => t.relation !== "entitled").concat(tuples.filter(t => t.relation === "entitled"));
      for (let offset = 0; offset < ordered.length; offset += 100) {
        const batch = ordered.slice(offset, offset + 100);
        await this.client.write(remove ? { deletes: batch } : { writes: batch }, {
          conflict: { onDuplicateWrites: ClientWriteRequestOnDuplicateWrites.Ignore, onMissingDeletes: ClientWriteRequestOnMissingDeletes.Ignore },
        });
      }
      return true;
    }, false, this.options.timeoutMs);
  }
  writeRelationships(request: RelationshipRequest): Promise<boolean> { return this.mutate(request, false); }
  deleteRelationships(request: RelationshipRequest): Promise<boolean> { return this.mutate(request, true); }
}
