// SPDX-License-Identifier: Apache-2.0
import type { AuthorizationContext, PermissionRequest, RelationshipRequest } from "./port";
import { TENANT_ROLES } from "./port";

const ID = /^[a-zA-Z0-9_-]{1,128}$/u;
const MODULE = /^[a-z][a-z0-9-]{1,63}$/u;
const PERMISSION = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*)+$/u;
function validId(value: unknown): boolean {
  return typeof value === "string" && ID.test(value);
}
export function validRequest({ tenantId, userId, moduleKey }: PermissionRequest): boolean {
  return validId(tenantId) && validId(userId) && typeof moduleKey === "string" && MODULE.test(moduleKey);
}
export function validRelationships(request: RelationshipRequest): boolean {
  return validId(request.tenantId) && Array.isArray(request.relationships) && request.relationships.length <= 100
    && request.relationships.every((r) => (r.version === undefined || validId(r.version)) && (r.kind === "membership"
      ? validId(r.userId) && TENANT_ROLES.includes(r.role)
      : r.kind === "entitlement" && typeof r.moduleKey === "string" && MODULE.test(r.moduleKey)));
}

export function permissionsFor(context: AuthorizationContext | null, moduleKey: string): string[] {
  if (!context || !context.entitled || context.manifest.key !== moduleKey
    || !context.roles.length || context.roles.some((role) => !TENANT_ROLES.includes(role))) return [];
  const { manifest, roles, claims } = context;
  const base = `${moduleKey}.use`;
  if (manifest.rolePermissions === undefined) {
    // Explicit compatibility path: undeclared module-prefixed claims remain legacy.
    return [...new Set([base, ...(claims ?? []).filter((p) => PERMISSION.test(p) && p.startsWith(`${moduleKey}.`))])];
  }
  const granted = new Set(roles.flatMap((role) => Object.hasOwn(manifest.rolePermissions!, role)
    ? manifest.rolePermissions![role] ?? [] : []));
  return [...new Set(manifest.permissions)].filter((permission) =>
    PERMISSION.test(permission) && permission.startsWith(`${moduleKey}.`) && granted.has(permission)
    && (permission === base || claims === undefined || claims.includes(permission)));
}

/** Errors never escape as grants. The complete decision has a bounded deadline. */
export async function failClosed<T>(work: () => Promise<T>, fallback: T, timeoutMs = 1500): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), timeoutMs); })]);
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}
