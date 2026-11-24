import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error local.mjs is the Node entrypoint and has no declaration output.
import { loadControlPlaneMigrations } from "./local.mjs";
import type { MigrationFile } from "./runner";
import { TENANT_CORE_MIGRATIONS } from "./tenant-core";
import { TENANT_MODULE_CATALOGS } from "./tenant-modules";

const baseline = Object.fromEntries(JSON.parse(readFileSync(new URL("./catalog-baseline.json", import.meta.url), "utf8")));

describe("SQL assets retain the pre-build migration catalog", () => {
  it("preserves every migration ID and byte checksum", async () => {
    const controlPlane: MigrationFile[] = await loadControlPlaneMigrations();
    const catalog = [
      ...controlPlane.map(m => ({ ...m, id: `control-plane/${m.id}` })),
      ...TENANT_CORE_MIGRATIONS, ...TENANT_MODULE_CATALOGS.flat(),
    ];
    const hashes = Object.fromEntries(catalog.map(({ id, sql }) => [
      id, createHash("sha256").update(sql).digest("hex"),
    ]));
    expect(hashes).toEqual(baseline);
    for (const migration of catalog) {
      expect(migration.sql).toBe(readFileSync(new URL(`../sql/${migration.id}.sql`, import.meta.url), "utf8"));
    }
  });
});
