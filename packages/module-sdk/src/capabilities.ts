// SPDX-License-Identifier: Apache-2.0

export const MODULE_CAPABILITIES = ["support.ticket.read"] as const;
export type ModuleCapability = (typeof MODULE_CAPABILITIES)[number];

export interface ModuleCapabilityRequest {
  readonly capability: ModuleCapability;
  /** Module-scoped user permission required at every interactive invocation. */
  readonly runtimePermission: string;
}

export type ModuleCapabilityDenialReason =
  | "unknown_capability"
  | "unknown_ownership_scope"
  | "tenant_binding_invalid"
  | "manifest_not_requested"
  | "creator_authority_denied"
  | "tenant_grant_missing"
  | "grant_inactive"
  | "identity_required"
  | "runtime_permission_denied";

export interface ModuleCapabilityEvaluation {
  readonly moduleKey: string;
  readonly capability: string;
  readonly ownershipScope: string;
  readonly tenantBound: boolean;
  readonly activeVersionBound: boolean;
  readonly manifestRequested: boolean;
  readonly creatorAuthorized: boolean;
  readonly tenantGranted: boolean;
  readonly grantActive: boolean;
  readonly identityBacked: boolean;
  readonly requiredRuntimePermission: string | null;
  readonly runtimePermissions: readonly string[];
}

export type ModuleCapabilityDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: ModuleCapabilityDenialReason };

const knownCapabilities = new Set<string>(MODULE_CAPABILITIES);
const knownOwnershipScopes = new Set(["platform", "installation", "tenant"]);
const moduleKeyPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const permissionPattern = /^[a-z][a-z0-9-]{1,63}\.[a-z][a-z0-9._-]{1,127}$/u;

function validRuntimePermission(moduleKey: string, permission: string): boolean {
  return moduleKeyPattern.test(moduleKey)
    && permissionPattern.test(permission)
    && permission.startsWith(`${moduleKey}.`);
}

export function normalizeModuleCapabilityRequests(
  moduleKey: string,
  requests: readonly ModuleCapabilityRequest[],
): readonly ModuleCapabilityRequest[] {
  if (!moduleKeyPattern.test(moduleKey)) throw new Error("Capability request requires a valid module key");
  const seen = new Set<string>();
  const normalized = requests.map((request) => {
    if (!knownCapabilities.has(request.capability)) throw new Error("Capability request names an unknown module capability");
    if (!validRuntimePermission(moduleKey, request.runtimePermission)) {
      throw new Error("Capability request requires a module-bound runtime permission");
    }
    if (seen.has(request.capability)) throw new Error("Capability request contains a duplicate capability");
    seen.add(request.capability);
    return Object.freeze({
      capability: request.capability,
      runtimePermission: request.runtimePermission,
    });
  });
  return Object.freeze(normalized);
}

/** Pure denial-first intersection used by persistence and broker boundaries. */
export function decideModuleCapability(input: ModuleCapabilityEvaluation): ModuleCapabilityDecision {
  if (!knownCapabilities.has(input.capability)) return { allowed: false, reason: "unknown_capability" };
  if (!knownOwnershipScopes.has(input.ownershipScope)) {
    return { allowed: false, reason: "unknown_ownership_scope" };
  }
  if (!input.tenantBound || !input.activeVersionBound) {
    return { allowed: false, reason: "tenant_binding_invalid" };
  }
  if (!input.manifestRequested) return { allowed: false, reason: "manifest_not_requested" };
  if (!input.creatorAuthorized) return { allowed: false, reason: "creator_authority_denied" };
  if (!input.tenantGranted) return { allowed: false, reason: "tenant_grant_missing" };
  if (!input.grantActive) return { allowed: false, reason: "grant_inactive" };
  if (!input.identityBacked) return { allowed: false, reason: "identity_required" };
  if (
    input.requiredRuntimePermission === null
    || !validRuntimePermission(input.moduleKey, input.requiredRuntimePermission)
    || !input.runtimePermissions.includes(input.requiredRuntimePermission)
  ) {
    return { allowed: false, reason: "runtime_permission_denied" };
  }
  return { allowed: true };
}
