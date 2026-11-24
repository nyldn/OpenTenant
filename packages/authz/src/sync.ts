// SPDX-License-Identifier: Apache-2.0
import type { AuthorizationContext, AuthorizationPort, Relationship, TenantRole } from "./port";
import { TENANT_ROLES } from "./port";

/** Delete old roles first. On failure do not grant the replacement. Safe to replay. */
export async function syncMembership(port: AuthorizationPort, input: {
  tenantId: string; userId: string; role: TenantRole; active: boolean; version?: string; previousVersion?: string;
}): Promise<boolean> {
  const versions = [...new Set([undefined, input.previousVersion, input.version])];
  const relationships: Relationship[] = versions.flatMap(version => TENANT_ROLES.map(role => ({
    kind: "membership" as const, userId: input.userId, role, ...(version ? { version } : {}),
  })));
  if (!await port.deleteRelationships({ tenantId: input.tenantId, relationships })) return false;
  return !input.active || port.writeRelationships({ tenantId: input.tenantId, relationships: [{ kind: "membership", userId: input.userId, role: input.role, ...(input.version ? { version: input.version } : {}) }] });
}
export async function syncEntitlement(port: AuthorizationPort, input: {
  tenantId: string; moduleKey: string; enabled: boolean; version?: string; previousVersion?: string;
  manifest?: AuthorizationContext["manifest"];
}): Promise<boolean> {
  const request = { tenantId: input.tenantId, relationships: [{ kind: "entitlement" as const, moduleKey: input.moduleKey }] };
  const previous = { tenantId: input.tenantId, relationships: [...new Set([undefined, input.previousVersion, input.version])]
    .map(version => ({ ...request.relationships[0]!, ...(version ? { version } : {}) })) };
  if (!await port.deleteRelationships(previous)) return false;
  if (!input.enabled) return true;
  return port.writeRelationships({ tenantId: input.tenantId, relationships: [{ ...request.relationships[0]!,
    ...(input.version ? { version: input.version } : {}), ...(input.manifest ? { manifest: input.manifest } : {}),
  }] });
}
