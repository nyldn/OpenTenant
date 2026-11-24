import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
/** Public packages share one inventory for packaging, cache and publication proofs. */
export function publicPackages(root) {
  return ["packages", "modules", "tooling", "apps", "templates", "examples"].flatMap(parent =>
    readdirSync(join(root, parent), { withFileTypes: true }).filter(e => e.isDirectory())
      .map(e => join(root, parent, e.name)).filter(path => existsSync(join(path, "package.json")))
      .map(path => ({ path, manifest: JSON.parse(readFileSync(join(path, "package.json"), "utf8")) })),
  ).filter(p => p.manifest.private !== true);
}
