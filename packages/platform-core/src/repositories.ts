/**
 * Control-plane repository contracts. Implementations live in
 * @opentenant/database against the central Neon project; these interfaces keep
 * platform logic provider-neutral and testable in memory (spec 9.1).
 */
import type { IdentityProvider, TenantId } from "@opentenant/auth";
import type { HostResolution, IdentityOrgMapping, Tenant, TenantDomain } from "./tenant";
import type { TenantBrandPolicy } from "./branding";
import type { ModuleCatalogEntry, NavigationOverride, TenantModule } from "./modules";

export interface TenantRepository {
  create(tenant: Omit<Tenant, "createdAt" | "updatedAt">): Promise<Tenant>;
  getById(tenantId: TenantId): Promise<Tenant | null>;
  getBySlug(slug: string): Promise<Tenant | null>;
  setStatus(tenantId: TenantId, status: Tenant["status"]): Promise<void>;
  list(): Promise<Tenant[]>;
}

export interface DomainRepository {
  /** Resolve a normalized host to a tenant or the platform admin surface. */
  resolveHost(host: string): Promise<HostResolution>;
  listForTenant(tenantId: TenantId): Promise<TenantDomain[]>;
  addPending(domain: Omit<TenantDomain, "createdAt" | "active" | "verification">): Promise<TenantDomain>;
  markVerified(host: string): Promise<void>;
  activate(host: string): Promise<void>;
  remove(host: string): Promise<void>;
}

export interface IdentityOrgMappingRepository {
  getByTenant(tenantId: TenantId): Promise<IdentityOrgMapping | null>;
  getByExternalOrganization(
    provider: IdentityProvider,
    externalOrganizationId: string,
  ): Promise<IdentityOrgMapping | null>;
  set(mapping: IdentityOrgMapping): Promise<void>;
}

export interface BrandPolicyRepository {
  get(tenantId: TenantId): Promise<TenantBrandPolicy | null>;
  /** Persists a new policy version; rejects overrides touching locked keys. */
  save(policy: TenantBrandPolicy): Promise<TenantBrandPolicy>;
}

export interface ModuleRegistryRepository {
  catalog(): Promise<ModuleCatalogEntry[]>;
  tenantModules(tenantId: TenantId): Promise<TenantModule[]>;
  setTenantModule(module: TenantModule): Promise<void>;
  navigationOverrides(tenantId: TenantId): Promise<NavigationOverride[]>;
  saveNavigationOverride(override: NavigationOverride): Promise<NavigationOverride>;
}
