import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { STEPS, stepEnvironment } from "./db-sequence.mjs";
import { DATABASES } from "./create-integration-databases.mjs";

test("CI uses the same complete sequence as the local command", () => {
  assert.deepEqual(STEPS.map(s => s.id), ["stores", "custom-domains", "authorization-outbox", "provisioning-neon", "provisioning-postgres", "identity", "worker", "support-delivery", "support-ai-review", "tenant-export", "usage-export", "key-rotation", "rate-limit", "pg-observability", "migrations", "developer-mcp", "isolation-fuzz"]);
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /run: pnpm ci:db-sequence/u);
});

test("worker and identity cannot consume the provisioning suite's database state", () => {
  const source = { ADMIN_DATABASE_URL: "postgresql://postgres:synthetic@127.0.0.1:55433/postgres", PROVISIONING_CONTROL_DATABASE_URL: "stale", PROVISIONING_TENANT_DATABASE_URL: "stale" };
  const worker = stepEnvironment(STEPS.find(s => s.id === "worker"), source);
  const identity = stepEnvironment(STEPS.find(s => s.id === "identity"), source);
  assert.equal(new URL(worker.PROVISIONING_TENANT_DATABASE_URL).pathname, "/opentenant_it_worker_tenant");
  assert.equal(worker.PROVISIONING_CONTROL_DATABASE_URL, undefined);
  assert.equal(new URL(identity.PROVISIONING_CONTROL_DATABASE_URL).pathname, "/opentenant_it_identity_control");
  assert.equal(identity.PROVISIONING_TENANT_DATABASE_URL, undefined);
  for (const step of STEPS) for (const database of Object.values(step.databases)) assert.ok(DATABASES.includes(database));
});

test("unset administrative URL fails and unrelated inherited database URLs are removed", () => {
  assert.throws(() => stepEnvironment(STEPS[1], {}), /required/u);
  const env = stepEnvironment(STEPS[1], { ADMIN_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55433/postgres", UNREGISTERED_DATABASE_URL: "stale" });
  assert.equal(env.UNREGISTERED_DATABASE_URL, undefined);
  assert.ok(env.CUSTOM_DOMAINS_DATABASE_URL);
});

test("standalone database harness proofs also require exact counts and zero skips", async () => {
  const { validateNodeProof, NODE_DATABASE_PROOFS } = await import("./db-sequence-node-proofs.mjs");
  assert.equal(NODE_DATABASE_PROOFS.length, 2);
  const passing = "# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.equal(validateNodeProof(passing, 2).pass, 2);
  assert.throws(() => validateNodeProof(passing, 3), /exact cases/u);
  for (const key of ["fail", "cancelled", "skipped", "todo"]) assert.throws(() => validateNodeProof(passing.replace(`# ${key} 0`, `# ${key} 1`), 2), /zero failures/u);
});
