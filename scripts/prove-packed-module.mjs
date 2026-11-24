import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "opentenant-adopter-"));
const run = (args, cwd) => execFileSync("pnpm", args, { cwd, stdio: "inherit", env: process.env });
try {
  run(["--filter", "@example/module-hello", "build"], root);
  run(["pack", "--pack-destination", temporary], join(root, "examples/module-hello"));
  run(["pack", "--pack-destination", temporary], join(root, "packages/module-sdk"));
  const workspace = join(temporary, "host");
  const excluded = new Set(["node_modules", ".git", ".next", ".turbo", "graphify-out", ".agents", ".opentenant", ".claude", ".codex", ".npmrc", "playwright-report", "test-results"]);
  cpSync(root, workspace, { recursive: true, filter: path => {
    const name = basename(path);
    return !excluded.has(name) && !(name.startsWith(".env") && name !== ".env.example") && !/\.(?:pem|key|p12|pfx)$/iu.test(name);
  } });
  // Public SDK packages are not published yet. Supply the packed SDK through a
  // temporary scoped override; both tarballs expose the same dist exports as npm.
  const workspaceConfig = join(workspace, "pnpm-workspace.yaml");
  const override = `  '@example/module-hello>@opentenant/module-sdk': file:${join(temporary, "opentenant-module-sdk-0.1.0.tgz")}\n`;
  for (const path of [workspaceConfig, join(workspace, "pnpm-lock.yaml")]) {
    writeFileSync(path, readFileSync(path, "utf8").replace("overrides:\n", `overrides:\n${override}`));
  }
  const host = join(workspace, "apps/platform");
  const composition = join(host, "opentenant-modules.ts");
  const original = readFileSync(composition, "utf8");
  const files = execFileSync("git", ["ls-files", "apps/platform"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  const baseline = new Map(files.filter(file => !file.endsWith("package.json") && !file.endsWith("opentenant-modules.ts"))
    .map(file => [file, readFileSync(join(workspace, file), "utf8")]));
  const line = 'import { helloModule } from "@example/module-hello";';
  // Modify exactly one composition line; the import and registration share it.
  const installed = original.replace("export const installedModules = defineModules([", `${line} export const installedModules = defineModules([helloModule, `);
  assert.equal(original.split("\n").filter((value, index) => value !== installed.split("\n")[index]).length, 1);
  writeFileSync(composition, installed);
  const manifestPath = join(host, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  delete manifest.devDependencies["@example/module-hello"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  run(["add", "--prefer-offline", "--save-exact", "--ignore-scripts", join(temporary, "example-module-hello-0.1.0.tgz")], host);
  run(["install", "--frozen-lockfile", "--ignore-scripts", "--prefer-offline"], workspace);
  // ponytail: fixed build concurrency for constrained runners; raise it if proof time matters more than headroom.
  run(["turbo", "build", "--filter=@opentenant/platform^...", "--concurrency=2"], workspace);
  assert(existsSync(join(host, "node_modules/@example/module-hello/dist/index.js")), "Adopter must resolve built tarball exports");
  assert(!existsSync(join(host, "node_modules/@example/module-hello/src")), "Packed module must contain no source");
  run(["--filter", "@opentenant/platform", "build"], workspace);
  const fixture = readFileSync(join(root, "tooling/ci/fixtures/packed-adopter.test.tsx"), "utf8");
  writeFileSync(join(host, "lib/packed-adopter.test.tsx"), fixture);
  run(["--filter", "@opentenant/platform", "exec", "vitest", "run", "lib/packed-adopter.test.tsx"], workspace);
  // Compare every pre-existing host source file, allowing only composition and package metadata.
  for (const [file, content] of baseline) {
    assert.equal(readFileSync(join(workspace, file), "utf8"), content, `Core edit: ${file}`);
  }
  console.log("PASS packed adopter: build, route, navigation, live entitlement, migration and zero core edits");
} finally { rmSync(temporary, { recursive: true, force: true }); }
