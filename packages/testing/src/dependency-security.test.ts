import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps platform and starter Next releases above the reviewed RCE floor", () => {
  for (const path of ["apps/platform/package.json", "templates/tenant-module-nextjs/package.json"]) {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8"));
    // A caret with a patched floor also excludes known-vulnerable 15.5.21.
    expect(manifest.dependencies.next).toMatch(/^\^?15\.5\.\d+$/);
    expect(Number(manifest.dependencies.next.split(".")[2])).toBeGreaterThanOrEqual(29);
  }
});
