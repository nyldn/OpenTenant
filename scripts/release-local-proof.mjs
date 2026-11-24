import { createServer } from "node:net";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { publicPackages } from "../tooling/build/package-inventory.mjs";
import { localRegistry } from "./release-local-policy.mjs";
const root = resolve(import.meta.dirname, "..");
const started = performance.now();
const temporary = mkdtempSync(join(tmpdir(), "opentenant-release-"));
const copy = join(temporary, "source"), packs = join(temporary, "packs");
const tag = randomBytes(6).toString("hex"), registryContainer = `opentenant-registry-${tag}`, adopter = `opentenant-release-adopter-${tag}`;
const env = { ...process.env, pnpm_config_verify_deps_before_run: "false" };
const run = (command, args, cwd = copy, extraEnv = {}) => execFileSync(command, args, { cwd, env: { ...env, ...extraEnv }, stdio: "inherit", timeout: 600_000 });
const capture = (command, args) => execFileSync(command, args, { cwd: root, env, encoding: "utf8", timeout: 600_000 }).trim();
let passed = false;
try {
  // Versioning and any changeset changelogs are confined to this disposable copy.
  cpSync(root, copy, { recursive: true, filter: source => !source.slice(root.length).split("/").some(part => ["node_modules", ".git", ".next", ".turbo", "graphify-out", "artifacts", "test-results", "playwright-report", ".pnpm-store", ".opentenant", ".env", ".env.local", ".npmrc"].includes(part) || (part.startsWith(".env") && part !== ".env.example") || /\.(pem|key|p12|pfx)$/.test(part)) });
  symlinkSync(join(root, "node_modules"), join(copy, "node_modules"), "dir");
  for (const parent of ["packages", "modules", "tooling", "apps", "templates", "examples"]) for (const name of readdirSync(join(copy, parent))) {
    const original = join(root, parent, name, "node_modules");
    if (existsSync(original)) symlinkSync(original, join(copy, parent, name, "node_modules"), "dir");
  }
  const packages = publicPackages(copy);
  writeFileSync(join(copy, ".changeset", "local-proof.md"), `---\n${packages.map(p => `"${p.manifest.name}": patch`).join("\n")}\n---\nDisposable local publication proof.\n`);
  run("pnpm", ["changeset", "version"]);
  run("pnpm", ["turbo", "build", "--force", "--filter=./packages/*", "--filter=./modules/*", "--filter=./examples/*", "--filter=@opentenant/migrations", "--filter=@opentenant/provisioning"]);
  run("pnpm", ["package:check"], copy, { PACKAGES_PROOF_DIRECTORY: packs });
  const evidence = JSON.parse(readFileSync(join(packs, "evidence.json"), "utf8"));
  assert.equal(evidence.length, packages.length);
  // Verdaccio 6.10.5 is MIT licensed. No upstream proxy for any public project name.
  const config = join(temporary, "config.yaml");
  writeFileSync(config, `storage: /verdaccio/storage\nauth:\n  htpasswd:\n    file: /verdaccio/storage/htpasswd\nuplinks:\n  npmjs:\n    url: https://registry.npmjs.org/\npackages:\n  '@opentenant/*':\n    access: $all\n    publish: $authenticated\n  '@example/*':\n    access: $all\n    publish: $authenticated\n  'create-opentenant':\n    access: $all\n    publish: $authenticated\n  '**':\n    access: $all\n    proxy: npmjs\nlog: {type: stdout, format: json, level: warn}\n`);
  // The registry runs as a non-root image user; host umask may be 0077.
  chmodSync(config, 0o644);
  run("docker", ["run", "--detach", "--rm", "--name", registryContainer, "--publish", "127.0.0.1::4873", "--mount", `type=bind,src=${config},dst=/verdaccio/conf/config.yaml,readonly`, "verdaccio/verdaccio:6.10.5"], root);
  const binding = capture("docker", ["port", registryContainer, "4873/tcp"]);
  const registry = localRegistry(`http://${binding}`);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${registry}/-/ping`)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, "Verdaccio startup timed out");
  const response = await fetch(`${registry}/-/user/org.couchdb.user:proof`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "proof", password: randomBytes(24).toString("hex") }) });
  assert(response.ok, "Local registry account creation failed");
  const { token } = await response.json();
  assert(token, "Local registry token missing");
  const npmrc = join(temporary, "npmrc");
  writeFileSync(npmrc, `registry=${registry}/\n//${binding}/:_authToken=${token}\n`, { mode: 0o600 });
  for (const item of evidence) {
    localRegistry(registry);
    const manifest = JSON.parse(capture("tar", ["-xOf", join(packs, item.filename), "package/package.json"]));
    if (manifest.publishConfig?.registry) assert.equal(localRegistry(manifest.publishConfig.registry), registry);
    run("npm", ["publish", join(packs, item.filename), `--registry=${registry}`, "--access=public", "--provenance=false", "--ignore-scripts", `--userconfig=${npmrc}`], copy);
    const metadata = await (await fetch(`${registry}/${encodeURIComponent(item.name)}/${item.version}`)).json();
    assert.deepEqual(metadata.exports ?? null, item.exports, `${item.name}: published exports`);
    assert.equal(new URL(metadata.dist.tarball).origin, registry, "Tarball must come from this local registry");
    const bytes = Buffer.from(await (await fetch(metadata.dist.tarball)).arrayBuffer());
    assert.equal(createHash("sha512").update(bytes).digest("hex"), item.sha512, `${item.name}: published bytes must match package:check`);
    console.log(`PASS registry tarball: ${item.name}@${item.version}; bytes, files and exports match package:check`);
  }
  // The clean adopter downloads every tarball from Verdaccio. No host packs,
  // source checkout, node_modules or package-manager cache enter its container.
  const runtime = join(temporary, "runtime.env");
  assert(process.env.ADMIN_DATABASE_URL, "Run through pnpm db:ephemeral");
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  writeFileSync(runtime, `POSTGRES_ADMIN_DATABASE_URL=${process.env.ADMIN_DATABASE_URL}\nREGISTRY=${registry}\nRELEASE_VERSION=${evidence[0].version}\nPORT=${port}\npnpm_config_verify_deps_before_run=false\n`, { mode: 0o600 });
  const inventory = join(temporary, "inventory.json");
  writeFileSync(inventory, JSON.stringify(evidence));
  run("docker", ["run", "--rm", "--name", adopter, "--network=host", "--env-file", runtime, "--mount", `type=bind,src=${join(root, "scripts/release-local-container.mjs")},dst=/runner.mjs,readonly`, "--mount", `type=bind,src=${inventory},dst=/inventory.json,readonly`, "--mount", `type=bind,src=${join(root, "scripts/scaffold-start-check.mjs")},dst=/scaffold-start-check.mjs,readonly`, "--tmpfs", "/work:exec,size=3g", "--workdir", "/work", "node:22-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb", "node", "/runner.mjs"], root);
  passed = true;
} finally {
  for (const name of [adopter, registryContainer]) { try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch { /* already removed */ } }
  rmSync(temporary, { recursive: true, force: true });
  const report = { passed, packages: passed ? publicPackages(root).length : 0, duration_seconds: Number(((performance.now() - started) / 1000).toFixed(3)), provenance: "Requires owner-gated GitHub OIDC release workflow; not verified locally" };
  console.log(JSON.stringify(report));
  if (process.env.RELEASE_LOCAL_REPORT) writeFileSync(process.env.RELEASE_LOCAL_REPORT, JSON.stringify(report, null, 2) + "\n");
  if (!passed) process.exitCode = 1;
}
