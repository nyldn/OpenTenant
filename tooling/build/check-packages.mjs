import { digest, writeObligations } from "./release-obligations.mjs";
import { publicPackages } from "./package-inventory.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const json = path => JSON.parse(readFileSync(path, "utf8"));
const run = (args, cwd = root) => execFileSync("pnpm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const packages = publicPackages(root);
assert(packages.length > 0, "No public packages discovered");
const licensePolicy = json(join(root, "tooling/build/license-policy.json"));
const proofDirectory = resolve(process.env.PACKAGES_PROOF_DIRECTORY ?? join(root, "dist/release-evidence"));
const target = `node22-esm-${process.platform}-${process.arch}`;
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const records = json(join(root, "tooling/build/copied-code.json"));
if (proofDirectory) mkdirSync(proofDirectory, { recursive: true });
const evidence = [];
const temp = mkdtempSync(join(tmpdir(), "opentenant-packages-"));
try {
  const sourceFilename = `opentenant-source-${revision}.tar.gz`;
  const sourceArchive = join(proofDirectory, sourceFilename);
  execFileSync("git", ["archive", "--format=tar.gz", "--output", sourceArchive, revision], { cwd: root });
  const source = { revision, filename: sourceFilename, sha512: digest(readFileSync(sourceArchive)) };
  for (const { path, manifest } of packages) {
    const localLicense = existsSync(join(path, "LICENSE")) ? readFileSync(join(path, "LICENSE"), "utf8") : "";
    const expectedLicense = localLicense.includes("Apache License") ? "Apache-2.0" : "AGPL-3.0-only";
    assert.equal(manifest.license, expectedLicense, `${manifest.name}: licence must match LICENSING.md and directory overrides`);
    assert.equal(manifest.version.split(".")[0], "0", `${manifest.name}: expected 0.x`);
    assert.equal(manifest.version, packages[0].manifest.version, "Public versions must stay in lockstep");
    const listing = JSON.parse(run(["pack", "--dry-run", "--json"], path));
    const files = listing.files.map(f => f.path);
    assert(files.some(f => f.endsWith(".js")), `${manifest.name}: missing ESM`);
    assert(files.some(f => f.endsWith(".d.ts")), `${manifest.name}: missing declarations`);
    if (manifest.files.includes("sql")) assert(files.some(f => /^sql\/.*\.sql$/u.test(f)), `${manifest.name}: missing declared SQL assets`);
    assert(files.some(f => /(^|\/)LICENSE$/u.test(f)), `${manifest.name}: missing licence text`);
    for (const file of files) {
      assert(!/(^|\/)(src|tests?|__tests__|__fixtures__|node_modules)(\/|$)|\.(test|spec)\.|(^|\/)\.env|\.(pem|key|p12|pfx|map)$/iu.test(file), `${manifest.name}: forbidden tarball file ${file}`);
      assert(/^(dist\/.*\.(js|d\.ts)|dist\/LICENSE|sql\/.*\.sql|package\.json|LICENSE|README(?:\.md)?)$/u.test(file), `${manifest.name}: unexpected asset ${file}`);
    }
    // Inspect pnpm's real tarball too: workspace ranges must be rewritten.
    const packed = JSON.parse(run(["pack", "--json", "--pack-destination", temp], path));
    const archive = resolve(temp, packed.filename);
    const unpack = join(temp, manifest.name.replaceAll("/", "-"));
    mkdirSync(unpack);
    execFileSync("tar", ["-xzf", archive, "-C", unpack]);
    const packedManifest = readFileSync(join(unpack, "package/package.json"), "utf8");
    assert(!packedManifest.includes("workspace:"), `${manifest.name}: unresolved workspace range`);
    const obligations = writeObligations({ root, packagePath: path, unpacked: join(unpack, "package"), files, source, policy: licensePolicy, records, target });
    execFileSync("tar", ["-czf", archive, "-C", unpack, "package"]);
    const bytes = readFileSync(archive);
    writeFileSync(join(proofDirectory, basename(packed.filename)), bytes);
    evidence.push({ name: manifest.name, version: manifest.version, filename: basename(packed.filename),
      sha512: digest(bytes), files: execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").filter(file => !file.endsWith("/")),
      exports: manifest.exports ?? null, obligations });
    run(["exec", "publint", join(unpack, "package"), "--strict"]);
    run(["exec", "attw", archive, "--profile", "esm-only", "--no-definitely-typed"]);
    console.log(`PASS ${manifest.name}: files, publint, ATTW; copied-code blockers: ${obligations.unattributedCopies}`);
  }
  const scanReport = join(temp, "gitleaks.json");
  try { execFileSync("gitleaks", ["dir", temp, "--config", join(root, "tooling/build/gitleaks.toml"), "--redact=100", "--no-banner", "--no-color", "--report-format", "json", "--report-path", scanReport], { stdio: "pipe" }); }
  catch { throw new Error(`Artifact secret scan failed; findings: ${existsSync(scanReport) ? json(scanReport).length : "unavailable"}`); }
  // Exercise emitted catalogs, rather than merely hashing files copied to the package.
  const migrations = packages.find(p => p.manifest.name === "@opentenant/migrations");
  const core = await import(pathToFileURL(join(migrations.path, "dist/tenant-core.js")).href);
  const modules = await import(pathToFileURL(join(migrations.path, "dist/tenant-modules.js")).href);
  const baseline = Object.fromEntries(json(join(migrations.path, "src/catalog-baseline.json")));
  const hashes = Object.fromEntries([...core.TENANT_CORE_MIGRATIONS, ...modules.TENANT_MODULE_CATALOGS.flat()]
    .map(({ id, sql }) => [id, createHash("sha256").update(sql).digest("hex")]));
  for (const [id, checksum] of Object.entries(baseline)) {
    assert.equal(createHash("sha256").update(readFileSync(join(migrations.path, "sql", `${id}.sql`))).digest("hex"), checksum, `${id}: SQL drift`);
    if (!id.startsWith("control-plane/")) assert.equal(hashes[id], checksum, `${id}: built catalog drift`);
  }
  const licenses = JSON.parse(run(["licenses", "list", "--prod", "--json"]));
  const sbomPackages = [];
  for (const [license, dependencies] of Object.entries(licenses)) {
    for (const dependency of dependencies) {
      for (const version of dependency.versions) {
        const key = `${dependency.name}@${version}`;
        assert(licensePolicy.allowedLicenses.includes(license) || licensePolicy.existingRuntimeExceptions[key] === license,
          `Unreviewed dependency licence: ${key}: ${license}`);
        sbomPackages.push({ SPDXID: `SPDXRef-Package-${sbomPackages.length}`, name: dependency.name, versionInfo: version,
          downloadLocation: `https://registry.npmjs.org/${dependency.name}/-/${dependency.name.split("/").at(-1)}-${version}.tgz`,
          filesAnalyzed: false, licenseConcluded: license === "MIT License" ? "MIT" : license, licenseDeclared: license === "MIT License" ? "MIT" : license });
      }
    }
  }
  for (const { manifest } of packages) sbomPackages.push({ SPDXID: `SPDXRef-Package-${sbomPackages.length}`, name: manifest.name,
    versionInfo: manifest.version, downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: manifest.license, licenseDeclared: manifest.license });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist/packages.spdx.json"), JSON.stringify({ spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT", name: "OpenTenant packages", documentNamespace: `https://spdx.org/spdxdocs/opentenant-${randomUUID()}`,
    documentDescribes: sbomPackages.map(p => p.SPDXID),
    creationInfo: { creators: ["Tool: opentenant-package-check"], created: new Date().toISOString() }, packages: sbomPackages }, null, 2) + "\n");
  if (proofDirectory) writeFileSync(join(proofDirectory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  const unattributedCopies = evidence.reduce((count, artifact) => count + artifact.obligations.unattributedCopies, 0);
  assert.equal(unattributedCopies, 0, `Release blocked: unattributed copied-code files: ${unattributedCopies}`);
  console.log(`PASS ${packages.length} public packages; SQL catalog, secret scan and ${sbomPackages.length} SBOM licence entries`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
