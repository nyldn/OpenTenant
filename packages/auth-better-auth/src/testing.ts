/** Baseline for a forward-migration integration fixture. Later migrations must
 * run after the migration under test, never before it. Kept separate from the
 * runtime so the integrator can repair fixtures outside this task's ownership.
 */
export function migrationCatalogBefore<T extends { id: string }>(catalog: readonly T[], targetId: string): T[] {
  return catalog.filter((migration) => migration.id.localeCompare(targetId) < 0);
}
