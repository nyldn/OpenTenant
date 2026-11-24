// SPDX-License-Identifier: Apache-2.0
import type { ModuleManifest } from "@opentenant/module-sdk";

export type TenantRole = "tenant_owner" | "tenant_admin" | "tenant_member";
export const TENANT_ROLES: readonly TenantRole[] = ["tenant_owner", "tenant_admin", "tenant_member"];
export interface PermissionRequest { tenantId: string; userId: string; moduleKey: string }
export interface CheckRequest {
  tenantId: string;
  userId: string;
  /** Fully qualified manifest permission, e.g. brain.promote. */
  relation: string;
  object: { tenantId: string; moduleKey: string };
}
/** High-level relationships only. Raw provider tuples never cross this port. */
export type Relationship =
  | { kind: "membership"; userId: string; role: TenantRole; version?: string }
  | { kind: "entitlement"; moduleKey: string; version?: string; manifest?: ModuleManifest };
export interface RelationshipRequest { tenantId: string; relationships: readonly Relationship[] }
export interface AuthorizationPort {
  check(request: CheckRequest): Promise<boolean>;
  listPermissions(request: PermissionRequest): Promise<string[]>;
  /** False means sync failed; callers must retry and must not acknowledge success. */
  writeRelationships(request: RelationshipRequest): Promise<boolean>;
  deleteRelationships(request: RelationshipRequest): Promise<boolean>;
}
/** Trusted, live control-plane context. Never take a manifest from IdP claims. */
export interface AuthorizationContext {
  manifest: ModuleManifest;
  /** Immutable lifecycle versions fence delayed provider writes after revocation. */
  membershipVersion?: string;
  moduleVersion?: string;
  entitled: boolean;
  roles: readonly TenantRole[];
  /** Undefined means no additional claim restriction; [] allows base use only. */
  claims?: readonly string[];
}
export interface AuthorizationOptions {
  loadContext(request: PermissionRequest): Promise<AuthorizationContext | null>;
  /** Whole operation deadline, including control-plane reads. Default 1500ms. */
  timeoutMs?: number;
}
