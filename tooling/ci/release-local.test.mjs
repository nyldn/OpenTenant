import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localRegistry } from "../../scripts/release-local-policy.mjs";
import { publicPackages } from "../build/package-inventory.mjs";
test("local publishing rejects public registries and ambiguous targets", () => {
  assert.equal(localRegistry("http://127.0.0.1:49123/"), "http://127.0.0.1:49123");
  for (const url of ["https://registry.npmjs.org", "http://localhost:4873", "http://127.0.0.1", "http://127.0.0.1:4873/path", "http://user:password@127.0.0.1:4873", "http://127.0.0.1:4873/?upstream=public"]) assert.throws(() => localRegistry(url));
});
test("publication uses the same complete inventory and byte validation as package:check", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const packages = publicPackages(root);
  assert(packages.some(p => p.manifest.name === "create-opentenant"));
  assert(packages.some(p => p.manifest.name === "@example/module-hello"));
  assert.equal(packages.length, 23);
  const source = readFileSync(new URL("../../scripts/release-local-proof.mjs", import.meta.url), "utf8");
  assert(source.includes('run("pnpm", ["changeset", "version"])'));
  assert(source.includes('PACKAGES_PROOF_DIRECTORY: packs'));
  assert(source.includes('item.sha512'));
  assert(source.includes('metadata.exports ?? null'));
});
