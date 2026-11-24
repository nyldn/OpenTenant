import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { TENANT_MODULE_CATALOGS } from "./tenant-modules";

// Provisioning applies only these catalogs. A migration file that is not
// listed here never reaches a provisioned tenant, even if directory-driven
// integration tests apply it.
describe("tenant module migration catalogs", () => {
  for (const catalog of TENANT_MODULE_CATALOGS) {
    const scope = catalog[0]!.id.split("/")[0];
    it(`lists every ${scope} SQL file in order`, async () => {
      const files = (await readdir(new URL(`../sql/${scope}/`, import.meta.url)))
        .filter((file) => file.endsWith(".sql"))
        .sort()
        .map((file) => `${scope}/${file.replace(/\.sql$/u, "")}`);
      expect(catalog.map((migration) => migration.id)).toEqual(files);
      for (const migration of catalog) {
        const disk = await readFile(new URL(`../sql/${migration.id}.sql`, import.meta.url), "utf8");
        const digest = (sql: string) => createHash("sha256").update(sql).digest("hex");
        expect(digest(migration.sql)).toBe(digest(disk));
      }
    });
  }
});

it("keeps historical module catalog order", () => {
  expect(TENANT_MODULE_CATALOGS.map(catalog => catalog[0]!.id.split("/")[0])).toEqual(["tenant-brain", "tenant-support"]);
});
