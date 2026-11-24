/**
 * Read model for the platform admin surface (server-only). Control-plane
 * reads only; every mutation goes through an explicit action route with its
 * own authorization check.
 */
import { controlPlanePool } from "./control-plane";

export interface AdminTenantRow {
  tenantId: string;
  slug: string;
  displayName: string;
  status: string;
  dataRegion: string;
  managedSupportEnabled: boolean;
  domains: Array<{ host: string; verification: string; active: boolean; displayLabel: string | null; verificationNote: string | null }>;
  modules: Array<{ moduleKey: string; enabled: boolean; accessMode: string | null }>;
  brandKey: string | null;
}

export async function adminTenantOverview(): Promise<AdminTenantRow[]> {
  const db = controlPlanePool();
  const [tenants, domains, modules, brands] = await Promise.all([
    db.query<{ tenant_id: string; slug: string; display_name: string; status: string; data_region: string; managed_support_enabled: boolean }>(
      "select tenant_id, slug, display_name, status, data_region, managed_support_enabled from tenants order by display_name",
    ),
    db.query<{ tenant_id: string; host: string; verification: string; active: boolean; display_label: string | null; verification_note: string | null }>(
      "select tenant_id, host, verification, active, display_label, verification_note from domains order by host",
    ),
    db.query<{ tenant_id: string; module_key: string; enabled: boolean; mode: string | null }>(
      `select tm.tenant_id, tm.module_key, tm.enabled, map.mode
         from tenant_modules tm
         left join module_access_policies map
           on map.tenant_id = tm.tenant_id and map.module_key = tm.module_key
        order by tm.module_key`,
    ),
    db.query<{ tenant_id: string; defaults: Record<string, unknown> }>(
      "select tenant_id, defaults from brand_policies",
    ),
  ]);

  return tenants.rows.map((t) => ({
    tenantId: t.tenant_id,
    slug: t.slug,
    displayName: t.display_name,
    status: t.status,
    dataRegion: t.data_region,
    managedSupportEnabled: t.managed_support_enabled,
    domains: domains.rows
      .filter((d) => d.tenant_id === t.tenant_id)
      .map((d) => ({
        host: d.host,
        verification: d.verification,
        active: d.active,
        displayLabel: d.display_label,
        verificationNote: d.verification_note,
      })),
    modules: modules.rows
      .filter((m) => m.tenant_id === t.tenant_id)
      .map((m) => ({ moduleKey: m.module_key, enabled: m.enabled, accessMode: m.mode })),
    brandKey:
      (brands.rows.find((b) => b.tenant_id === t.tenant_id)?.defaults?.cssBrandKey as string | undefined) ?? null,
  }));
}
