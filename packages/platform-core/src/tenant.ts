/**
 * Control-plane tenant model (architecture spec sections 9-10).
 */
import type { IdentityProvider, TenantId } from "@opentenant/auth";

export type { TenantId };

export type TenantLifecycleStatus = "provisioning" | "active" | "suspended" | "deleted";

/** Region policy is set at provisioning and gates data placement (spec 14). */
export type DataRegion = "us" | "eu" | "ap";

export interface Tenant {
  tenantId: TenantId;
  /** URL-safe stable slug used for the opentenant-managed subdomain. */
  slug: string;
  displayName: string;
  status: TenantLifecycleStatus;
  dataRegion: DataRegion;
  createdAt: Date;
  updatedAt: Date;
}

export type DomainVerification = "pending" | "verified" | "failed";

export interface TenantDomain {
  tenantId: TenantId;
  /** Normalized host (output of normalizeHost). Unique across the platform. */
  host: string;
  kind: "opentenant_subdomain" | "custom";
  verification: DomainVerification;
  /** Custom domains activate only after ownership verification passes. */
  active: boolean;
  createdAt: Date;
}

export interface IdentityOrgMapping {
  tenantId: TenantId;
  provider: IdentityProvider;
  externalOrganizationId: string;
}

export type HostResolution =
  | { kind: "platform_admin" }
  | { kind: "tenant"; tenant: Tenant }
  /** Unknown, suspended, or unverified host. Render a generic 404. */
  | { kind: "unknown" };
