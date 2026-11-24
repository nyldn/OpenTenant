import { proveScaffoldStart } from "./scaffold-start-check.mjs";
// Runs in a fresh Node 22 container. All project artifacts come from Verdaccio.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const run = (cmd, args, cwd = "/work") => execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
run("npm", ["install", "--global", "pnpm@11.13.1", "--registry=https://registry.npmjs.org"]);
const registry = process.env.REGISTRY;
const version = process.env.RELEASE_VERSION;
assert(registry && version);
run("npm", ["install", "--prefix", "/work/cli", `create-opentenant@${version}`, `--registry=${registry}`, "--ignore-scripts"]);
const { mkdirSync, writeFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
mkdirSync("/work/packs");
for (const item of JSON.parse(readFileSync("/inventory.json", "utf8"))) {
  const metadata = await (await fetch(`${registry}/${encodeURIComponent(item.name)}/${item.version}`)).json();
  assert.equal(new URL(metadata.dist.tarball).origin, registry);
  assert.deepEqual(metadata.exports ?? null, item.exports);
  const bytes = Buffer.from(await (await fetch(metadata.dist.tarball)).arrayBuffer());
  assert.equal(createHash("sha512").update(bytes).digest("hex"), item.sha512);
  writeFileSync(`/work/packs/${item.filename}`, bytes);
}
run("node", ["/work/cli/node_modules/create-opentenant/dist/cli.js", "--name", "example-app", "--identity", "local", "--provisioning", "postgres", "--tarballs", "/work/packs", "--yes"]);
await proveScaffoldStart("/work/example-app");
