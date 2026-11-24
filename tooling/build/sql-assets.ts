import { readFileSync } from "node:fs";
/** Build SQL as ESM text while shipping the original SQL alongside the package. */
export function sqlAssets() {
  return { name: "module-sql-assets", load(id: string) {
    if (id.endsWith(".sql")) return { code: `export default ${JSON.stringify(readFileSync(id, "utf8"))};` };
  } };
}
