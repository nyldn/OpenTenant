import { readdir, readFile } from "node:fs/promises";
import type { MigrationFile } from "./runner";
/** Load the canonical SQL assets shipped beside the built package. */
export async function loadControlPlaneMigrations(): Promise<MigrationFile[]> {
  const directory = new URL("../sql/control-plane/", import.meta.url);
  return Promise.all((await readdir(directory)).filter(name => name.endsWith(".sql")).sort().map(async name => ({ id: name.slice(0, -4), sql: await readFile(new URL(name, directory), "utf8") })));
}
