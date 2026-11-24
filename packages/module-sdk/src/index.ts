// SPDX-License-Identifier: Apache-2.0

import type { ModuleCapabilityRequest } from "./capabilities";

/**
 * @opentenant/module-sdk — the contract every OpenTenant module implements.
 *
 * Modules receive a normalized ModuleContext and declare themselves through a
 * versioned ModuleManifest. Modules never import provider SDKs or query
 * control-plane tables directly (architecture spec section 11).
 */

export interface ModuleManifest {
  /** Stable module key, e.g. "module". Never reused or renamed. */
  key: string;
  /** Semantic version of the module implementation. */
  version: string;
  /** Native modules compile into the platform app; remote is a later phase. */
  runtime: "native" | "remote";
  /** Navigation items this module contributes. IDs are stable forever. */
  navigation: ModuleNavigationItem[];
  /** Permissions the module defines; enforced at route, action, and repository layers. */
  permissions: string[];
  /**
   * Platform role ceiling. Only listed, declared permissions can be granted.
   * New manifests should always set this, even to {} to deny every permission.
   * Omission opts into legacy claim passthrough for existing installations.
   */
  rolePermissions?: Readonly<Partial<Record<"tenant_owner" | "tenant_admin" | "tenant_member", readonly string[]>>>;
  /** Tenant data is unavailable unless every requested capability is separately granted. */
  capabilities?: readonly ModuleCapabilityRequest[];
}

export interface ModuleNavigationItem {
  /** Stable item ID; tenant overrides reference this and never invent new ones. */
  id: string;
  defaultLabel: string;
  /** Optional label for an authorized header shortcut to this navigation item. */
  headerLabel?: string;
  route: string;
  /** Fields a tenant admin may override. Everything else is locked. */
  configurable: ReadonlyArray<"label" | "group" | "order" | "visibility">;
  requiredPermission: string;
}

export interface ModuleContext {
  tenantId: string;
  userId: string;
  permissions: ReadonlySet<string>;
}

export {
  decideModuleCapability,
  MODULE_CAPABILITIES,
  normalizeModuleCapabilityRequests,
} from "./capabilities";
export type {
  ModuleCapability,
  ModuleCapabilityDecision,
  ModuleCapabilityDenialReason,
  ModuleCapabilityEvaluation,
  ModuleCapabilityRequest,
} from "./capabilities";

export { defineModule, defineModules } from "./registry";
export type {
  ModuleDefinition, ModuleMigration, ModulePageContext, ModulePage,
  ModuleRegistry, ModuleRoute, ModulePanel, ModuleRole,
} from "./registry";
