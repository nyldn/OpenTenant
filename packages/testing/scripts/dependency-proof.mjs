// @ts-check
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
/** SPDX policy for the dependencies introduced by the test-hardening batch. */
const allowed = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "PostgreSQL"]);

/** @param {Array<{name: string, version: string, license: string}>} packages */
export function propertyTestDependencyBom(packages) {
  if (packages.length !== 2 || packages[0]?.name !== "fast-check" || packages[1]?.name !== "pure-rand") throw new Error("unexpected property-test dependency inventory");
  return {
    bomFormat: "CycloneDX", specVersion: "1.6", version: 1,
    components: packages.map(pkg => {
      if (!allowed.has(pkg.license)) throw new Error(`unapproved dependency license: ${pkg.name}`);
      return { type: "library", name: pkg.name, version: pkg.version, purl: `pkg:npm/${pkg.name}@${pkg.version}`, licenses: [{ license: { id: pkg.license } }], scope: "optional" };
    }),
  };
}

export function installedPropertyTestDependencyBom() {
  const fastCheckPath = require.resolve("fast-check/package.json");
  const fastCheck = JSON.parse(readFileSync(fastCheckPath, "utf8"));
  const dependencyRequire = createRequire(fastCheckPath);
  const pureRand = JSON.parse(readFileSync(dependencyRequire.resolve("pure-rand/package.json"), "utf8"));
  return propertyTestDependencyBom([fastCheck, pureRand]);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.argv[2]) throw new Error("dependency proof requires an SBOM output path");
  writeFileSync(process.argv[2], `${JSON.stringify(installedPropertyTestDependencyBom(), null, 2)}\n`);
}
