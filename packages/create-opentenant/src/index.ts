import { mkdir, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import * as templates from "./templates";
export interface ScaffoldOptions { name: string; identity: "local" | "better-auth"; provisioning: "postgres"; tarballs: string; cwd?: string; }
/** Creates a new directory only. Unpublished packages must come from real pnpm packs. */
export async function scaffold(options: ScaffoldOptions): Promise<string> {
  if (!/^[a-z][a-z0-9-]{2,30}$/u.test(options.name) || !["local", "better-auth"].includes(options.identity) || options.provisioning !== "postgres") throw new Error("Invalid scaffold options");
  const tarballs = resolve(options.tarballs), dependencies: Record<string, string> = {};
  for (const file of await readdir(tarballs)) {
    if (!file.endsWith(".tgz")) continue;
    const archive = join(tarballs, file);
    const manifest = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }));
    if (typeof manifest.name === "string" && manifest.name.startsWith("@opentenant/")) dependencies[manifest.name] = `file:${archive}`;
  }
  for (const name of ["module-sdk", "migrations", "provisioning", "platform-core"]) if (!dependencies[`@opentenant/${name}`]) throw new Error(`Missing packed @opentenant/${name}`);
  const target = resolve(options.cwd ?? process.cwd(), options.name);
  await mkdir(target); // EEXIST is deliberate: never overwrite an adopter's files.
  const manifest = { name: options.name, private: true, type: "module", engines: { node: ">=22 <23" }, packageManager: "pnpm@11.13.1", scripts: { setup: "node --experimental-strip-types setup.ts", start: "node --experimental-strip-types server.ts" }, dependencies: { ...dependencies, pg: "8.23.1" }, devDependencies: { "@types/node": "22.20.1", "@types/pg": "8.20.4", typescript: "5.9.3" } };
  await writeFile(join(target, "package.json"), JSON.stringify(manifest, null, 2)+"\n");
  // Overrides resolve transitive, unpublished workspace names to the same packs.
  await writeFile(join(target, "pnpm-workspace.yaml"), `packages: []\noverrides:\n${Object.entries(dependencies).map(([k,v]) => `  '${k}': '${v.replaceAll("'", "''")}'`).join("\n")}\n`);
  for (const [file, value] of Object.entries({ "opentenant-modules.ts": templates.composition, "config.ts": templates.config, "setup.ts": templates.setup, "server.ts": templates.server, "compose.yaml": templates.compose, ".env.example": templates.environment, ".gitignore": "node_modules/\n.env\n.opentenant-*.json\n", "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true }, include: ["*.ts"] }) })) await writeFile(join(target, file), value.replaceAll("__NAME__", options.name).replaceAll("__IDENTITY__", options.identity));
  return target;
}
