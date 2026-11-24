import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestFor } from "./runtime.mjs";
import { validateRunRecords, validateDatabaseTargets, readOwnedRun } from "./control-guard.mjs";
import { parseCommand, operatorCommand } from "./control.mjs";
import { armProvisionConflict, clearProvisionConflict, provisionControlStatus, resetControlState } from "./provision-control.mjs";
import { expireExports } from "./export-control.mjs";

const root = "/synthetic/worktree";
const runId = "ab".repeat(12);
function fixture() {
  const manifest = manifestFor({ runId, worktree: root, appPort: 31001, nextPort: 31002, mailPort: 31003, smtpPort: 31004, postgresPort: 31005, dnsPort: 31006, upstreamPort: 31007, users: [], tenants: [{ slug: "alpha", tenantId: "tenant_alpha" }], mode: "dev" });
  return { manifest, owner: { runId, worktree: root, pid: 42, stamp: "123" }, control: { runId, worktree: root, appPort: 31001, stopToken: "c".repeat(64) } };
}
function databaseFixture() {
  const containerName = "opentenant-proof-00000000-0000-4000-8000-000000000001";
  return {
    target: { containerName, port: 31005, adminUrl: "postgresql://postgres:synthetic@127.0.0.1:31005/postgres", controlUrl: "postgresql://postgres:synthetic@127.0.0.1:31005/opentenant_ephemeral" },
    inspection: { Name: `/${containerName}`, State: { Running: true }, HostConfig: { NetworkMode: "none" }, Config: { Image: "pgvector/pgvector:0.8.2-pg17-bookworm", Labels: { "opentenant.uat": "true", "opentenant.uat.run": runId, "opentenant.uat.workspace": createHash("sha256").update(root).digest("hex").slice(0, 20) } } },
  };
}

test("operator accepts only this run's loopback manifest and disposable container", () => {
  const records = fixture();
  assert.equal(validateRunRecords(root, records).manifest.runId, runId);
  const { target, inspection } = databaseFixture();
  validateDatabaseTargets(target, records.manifest, inspection, root);
  assert.deepEqual(parseCommand(["fail-next-provision"]), { action: "fail-next-provision" });
  assert.deepEqual(parseCommand(["fail-next-provision", "uat-second"]), { action: "fail-next-provision", slug: "uat-second" });
  assert.deepEqual(parseCommand(["expire-exports", "alpha"]), { action: "expire-exports", slug: "alpha" });
});

for (const [name, mutate] of [
  ["foreign worktree", r => { r.manifest.worktree = "/other"; }],
  ["foreign owner", r => { r.owner.worktree = "/other"; }],
  ["stale control", r => { r.control.runId = "cd".repeat(12); }],
  ["missing owner identity", r => { delete r.owner.stamp; }],
  ["invalid owner pid", r => { r.owner.pid = 1; }],
  ["remote admin", r => { r.manifest.adminHost = "http://admin.example.test:31001/admin"; }],
  ["remote tenant", r => { r.manifest.tenants[0].url = "http://alpha.example.test:31001/"; }],
  ["remote persona", r => { r.manifest.personas = [{ signInUrl: "http://example.test:31001/" }]; }],
  ["credential-bearing URL", r => { r.manifest.adminHost = "http://synthetic:private@admin.localhost:31001/admin"; }],
  ["remote mail", r => { r.manifest.mailpitUrl = "http://example.test:31003"; }],
  ["default Postgres", r => { r.manifest.ports.postgres = 5432; }],
  ["wrong gateway", r => { r.control.appPort = 31008; }],
]) test(`operator refuses ${name}`, () => {
  const records = fixture(); mutate(records);
  assert.throws(() => validateRunRecords(root, records));
});

for (const [name, mutate] of [
  ["remote database", (d) => { d.target.adminUrl = "postgresql://postgres:synthetic@example.test:31005/postgres"; }],
  ["driver host override", (d) => { d.target.adminUrl += "?host=example.test"; }],
  ["foreign database", (d) => { d.target.controlUrl = d.target.controlUrl.replace("ephemeral", "production"); }],
  ["stopped container", d => { d.inspection.State.Running = false; }],
  ["networked container", d => { d.inspection.HostConfig.NetworkMode = "bridge"; }],
  ["foreign container", d => { d.inspection.Config.Labels["opentenant.uat.run"] = "cd".repeat(12); }],
  ["foreign workspace label", d => { d.inspection.Config.Labels["opentenant.uat.workspace"] = "other"; }],
  ["service Postgres", d => { delete d.target.containerName; }],
  ["unreviewed image", d => { d.inspection.Config.Image = "postgres:17"; }],
]) test(`operator refuses ${name}`, () => {
  const d = databaseFixture(); mutate(d);
  assert.throws(() => validateDatabaseTargets(d.target, fixture().manifest, d.inspection, root));
});

test("stopped stacks fail closed before any control request", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "uat-stopped-"));
  try { await assert.rejects(readOwnedRun(temporary)); await assert.rejects(operatorCommand(temporary, { action: "status" })); }
  finally { await rm(temporary, { recursive: true, force: true }); }
});

test("operator rejects unknown commands and malformed slugs", () => {
  for (const args of [[], ["unknown"], ["status", "alpha"], ["fail-next-provision", "../alpha"], ["fail-next-provision", "alpha;drop"], ["clear", "extra"], ["expire-exports"], ["expire-exports", "../alpha"], ["expire-exports", "alpha", "beta"]]) assert.throws(() => parseCommand(args));
});

test("export expiry receipts distinguish updated archives, empty tenants and unknown slugs", async () => {
  let found = true;
  let count = 2;
  const context = { db: { query: async (_sql, args) => {
    assert.deepEqual(args, ["alpha"]);
    return { rows: [{ tenant_exists: found, expired_exports: count }] };
  } } };
  assert.deepEqual(await expireExports(context, "alpha"), { slug: "alpha", expiredExports: 2 });
  count = 0;
  assert.deepEqual(await expireExports(context, "alpha"), { slug: "alpha", expiredExports: 0 });
  found = false;
  await assert.rejects(expireExports(context, "alpha"), /Unknown synthetic tenant/);
});

test("provisioning conflict clears only its own table, leaves product retry state intact, and resets", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "uat-control-"));
  await mkdir(join(temporary, ".uat/active"), { recursive: true });
  const statements = [];
  let tenantExists = false;
  const context = {
    root: temporary, runId,
    db: { query: async (sql, args) => { statements.push([sql, args]); return { rows: sql.includes("tenant_worker_jobs") ? [{ status: "failed", attempts: 5 }] : tenantExists ? [{}] : [] }; } },
    provisioner: { findProjectByName: async () => tenantExists ? { projectId: "opentenant_uat_retry" } : null, createTenantProject: async () => ({ projectId: "opentenant_uat_retry" }), deleteProject: async () => { statements.push(["deleteProject"]); } },
    withDatabase: async (_name, work) => work({ query: async sql => { statements.push([sql]); return { rows: [{ column_name: "uat_conflict", data_type: "boolean" }] }; } }),
  };
  try {
    const armed = await armProvisionConflict(context);
    assert.equal(armed.slug, "uat-provision-retry");
    await assert.rejects(armProvisionConflict(context, "uat-second"), /Clear the armed control first/);
    assert.match(statements.find(([sql]) => sql.startsWith("create table"))[0], /schema_migrations \(uat_conflict boolean\)/);
    tenantExists = true;
    assert.deepEqual(await provisionControlStatus(context), { armed: true, slug: "uat-provision-retry", jobStatus: "failed", attempts: 5 });
    assert.equal((await clearProvisionConflict(context)).cleared, true);
    assert.ok(statements.some(([sql]) => sql === "drop table public.schema_migrations"));
    assert.ok(!statements.some(([sql]) => /update tenant|deleteProject/.test(sql)));
    assert.equal((await provisionControlStatus(context)).armed, false);
    assert.equal((await clearProvisionConflict(context)).cleared, true);
    await resetControlState(temporary);
    await assert.rejects(readFile(join(temporary, ".uat/active/provision-control.json")));
    assert.deepEqual(await provisionControlStatus(context), { armed: false });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("arming refuses existing tenants/databases and rolls back a failed fixture setup", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "uat-arm-"));
  await mkdir(join(temporary, ".uat/active"), { recursive: true });
  let tenantExists = true;
  let databaseExists = false;
  const removed = [];
  const context = {
    root: temporary, runId,
    db: { query: async () => ({ rows: tenantExists ? [{}] : [] }) },
    provisioner: {
      findProjectByName: async () => databaseExists ? { projectId: "opentenant_owned" } : null,
      createTenantProject: async () => ({ projectId: "opentenant_owned" }),
      deleteProject: async name => { removed.push(name); },
    },
    withDatabase: async () => { throw new Error("Synthetic fixture setup failed"); },
  };
  try {
    await assert.rejects(armProvisionConflict(context), /Use a new synthetic tenant slug/);
    tenantExists = false; databaseExists = true;
    await assert.rejects(armProvisionConflict(context), /Use a new synthetic tenant slug/);
    assert.deepEqual(removed, []);
    databaseExists = false;
    await assert.rejects(armProvisionConflict(context), /Synthetic fixture setup failed/);
    assert.deepEqual(removed, ["opentenant_owned"]);
    assert.deepEqual(await provisionControlStatus(context), { armed: false });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("clear refuses a changed conflict table and removes an unused fixture safely", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "uat-clear-"));
  await mkdir(join(temporary, ".uat/active"), { recursive: true });
  let columns = [{ column_name: "id", data_type: "text" }];
  let dropped = false;
  let removed = false;
  const context = {
    root: temporary, runId,
    db: { query: async () => ({ rows: [] }) },
    provisioner: { findProjectByName: async () => ({ projectId: "opentenant_owned" }), deleteProject: async () => { removed = true; } },
    withDatabase: async (_name, work) => work({ query: async sql => {
      if (sql.startsWith("drop")) dropped = true;
      return { rows: columns };
    } }),
  };
  try {
    await writeFile(join(temporary, ".uat/active/provision-control.json"), JSON.stringify({ worktree: temporary, runId, slug: "uat-retry", database: "opentenant_owned", phase: "armed" }));
    await assert.rejects(clearProvisionConflict(context), /UAT conflict table changed/);
    assert.equal(dropped, false); assert.equal(removed, false);
    columns = [{ column_name: "uat_conflict", data_type: "boolean" }];
    assert.equal((await clearProvisionConflict(context)).cleared, true);
    assert.equal(dropped, true); assert.equal(removed, true);
    assert.deepEqual(await provisionControlStatus(context), { armed: false });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
