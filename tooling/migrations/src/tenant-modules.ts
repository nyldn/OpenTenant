import type { Pool } from "pg";
import { installedModules } from "../../../apps/platform/opentenant-modules";
import { applyMigrations, type MigrationFile } from "./runner";

export const TENANT_MODULE_CATALOGS: readonly (readonly MigrationFile[])[] = installedModules.migrations.tenant.filter((catalog) => catalog.length > 0);
/** Core metadata and the application role must exist before module catalogs. */
export async function migrateTenantModules(pool: Pool) {
  const applied: string[] = [], skipped: string[] = [];
  for (const catalog of TENANT_MODULE_CATALOGS) {
    const result = await applyMigrations(pool, catalog);
    applied.push(...result.applied); skipped.push(...result.skipped);
  }
  return { applied, skipped };
}
