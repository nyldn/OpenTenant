import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { scaffold } from "./index";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "opentenant-cli-test-")); directories.push(cwd);
  const packs = join(cwd, "packs"); await mkdir(packs); const packageDir = join(cwd, "package"); await mkdir(packageDir);
  for (const name of ["module-sdk", "assessment", "brain", "support", "migrations", "provisioning", "platform-core"]) {
    await writeFile(join(packageDir,"package.json"),JSON.stringify({ name: `@opentenant/${name}`, version: "0.1.0" })); execFileSync("tar", ["-czf",join(packs,`${name}.tgz`),"-C",cwd,"package"]);
  }
  return { cwd, tarballs: packs, name: "example-app", identity: "local" as const, provisioning: "postgres" as const };
}
it("creates typed configuration, registry composition and placeholder environment for both identities", async () => {
  const options = await fixture();
  for (const identity of ["local", "better-auth"] as const) {
    const directory = await scaffold({ ...options, identity, name: `example-${identity}` });
    expect(await readFile(join(directory,"config.ts"),"utf8")).toContain(`'${identity}'`);
    expect(await readFile(join(directory,".env.example"),"utf8")).toContain("REPLACE_WITH_LOCAL_RANDOM_VALUE");
    expect(await readFile(join(directory,"opentenant-modules.ts"),"utf8")).toContain("defineModules");
    expect(await readFile(join(directory,"pnpm-workspace.yaml"),"utf8")).toContain("file:");
    expect(await readFile(join(directory,"setup.ts"),"utf8")).toContain("prepareTenantDatabase");
  }
});
it("rejects traversal and missing packs before creating a host", async () => {
  const options = await fixture(); await expect(scaffold({ ...options, name: "../outside" })).rejects.toThrow();
  const empty = join(options.cwd, "empty"); await mkdir(empty); await expect(scaffold({ ...options, tarballs: empty })).rejects.toThrow("Missing packed");
});
it("preserves existing adopter files", async () => { const options = await fixture(); const target = join(options.cwd, options.name); await mkdir(target); await writeFile(join(target,"owned"), "keep"); await expect(scaffold(options)).rejects.toThrow(); expect(await readFile(join(target,"owned"),"utf8")).toBe("keep"); });
