// SPDX-License-Identifier: Apache-2.0
import type { AuthorizationOptions, AuthorizationPort, CheckRequest, PermissionRequest, RelationshipRequest } from "../port";
import { TENANT_ROLES } from "../port";
import { failClosed, permissionsFor, validRelationships, validRequest } from "../policy";

/**
 * Default adapter. Live context is authoritative; synced tuples are an optional
 * additional restriction for consumers that use relationship sync.
 */
export class InProcessAuthorization implements AuthorizationPort {
  private readonly memberships = new Set<string>();
  private readonly entitlements = new Set<string>();
  private managedRelationships = false;
  constructor(private readonly options: AuthorizationOptions) {}

  listPermissions(request: PermissionRequest): Promise<string[]> {
    return failClosed(async () => {
      if (!validRequest(request)) return [];
      const context = await this.options.loadContext(request);
      if (this.managedRelationships) {
        if (!this.entitlements.has(JSON.stringify([request.tenantId, request.moduleKey, context?.moduleVersion]))) return [];
        if (!context) return [];
        const syncedRoles = TENANT_ROLES.filter((role) => this.memberships.has(JSON.stringify([request.tenantId, request.userId, role, context.membershipVersion])));
        const synced = permissionsFor({ ...context, roles: syncedRoles }, request.moduleKey);
        return permissionsFor(context, request.moduleKey).filter((permission) => synced.includes(permission));
      }
      return permissionsFor(context, request.moduleKey);
    }, [], this.options.timeoutMs);
  }
  check(request: CheckRequest): Promise<boolean> {
    return failClosed(async () => {
      if (request.tenantId !== request.object.tenantId) return false;
      return (await this.listPermissions({ ...request, moduleKey: request.object.moduleKey })).includes(request.relation);
    }, false, this.options.timeoutMs);
  }
  private async mutate(request: RelationshipRequest, remove: boolean): Promise<boolean> {
    return failClosed(async () => {
      if (!validRelationships(request)) return false;
      if (!request.relationships.length) return true;
      this.managedRelationships = true;
      for (const r of request.relationships) {
        const set = r.kind === "membership" ? this.memberships : this.entitlements;
        const key = JSON.stringify(r.kind === "membership" ? [request.tenantId, r.userId, r.role, r.version] : [request.tenantId, r.moduleKey, r.version]);
        if (remove) set.delete(key); else set.add(key);
      }
      return true;
    }, false, this.options.timeoutMs);
  }
  writeRelationships(request: RelationshipRequest): Promise<boolean> { return this.mutate(request, false); }
  deleteRelationships(request: RelationshipRequest): Promise<boolean> { return this.mutate(request, true); }
}
