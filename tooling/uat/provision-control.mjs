import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { NeonProvisioner } from "../provisioning/dist/index.js";

export const retrySlug = "uat-provision-retry";
const recordPath = root => join(root, ".uat/active/provision-control.json");
async function record(root, runId) {
  let state;
  try { state = JSON.parse(await readFile(recordPath(root), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (state.runId !== runId || state.worktree !== root || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(state.slug) || !/^opentenant_[a-z0-9_]{1,51}$/.test(state.database) || !["armed", "cleared"].includes(state.phase)) throw new Error("Invalid UAT control record");
  return state;
}

export async function provisionControlStatus({ root, runId, db }) {
  const state = await record(root, runId);
  if (!state) return { armed: false };
  const { rows } = await db.query("select j.status,j.attempts from tenant_worker_jobs j join tenants t on t.tenant_id=j.tenant_id where t.slug=$1 and j.kind='provision' order by j.created_at desc limit 1", [state.slug]);
  return { armed: state.phase === "armed", slug: state.slug, jobStatus: rows[0]?.status ?? "not_created", attempts: rows[0]?.attempts ?? 0 };
}

export async function armProvisionConflict(context, slug = retrySlug) {
  const { root, runId, db, provisioner, withDatabase } = context;
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw new Error("Invalid synthetic slug");
  if ((await record(root, runId))?.phase === "armed") throw new Error("Clear the armed control first");
  if ((await db.query("select 1 from tenants where slug=$1", [slug])).rows.length || await provisioner.findProjectByName(NeonProvisioner.tenantProjectName(slug))) throw new Error("Use a new synthetic tenant slug");
  const project = await provisioner.createTenantProject(slug, "eu");
  try {
    await withDatabase(project.projectId, client => client.query("create table public.schema_migrations (uat_conflict boolean)"));
    await writeFile(recordPath(root), JSON.stringify({ runId, worktree: root, slug, database: project.projectId, phase: "armed" }), { mode: 0o600 });
  } catch (error) { await provisioner.deleteProject(project.projectId); throw error; }
  return { armed: true, slug, next: "Create this slug in the product; wait for failed provisioning, then clear and retry." };
}

export async function clearProvisionConflict(context) {
  const { root, runId, db, provisioner, withDatabase } = context;
  const state = await record(root, runId);
  if (!state || state.phase === "cleared") return { cleared: true };
  const project = await provisioner.findProjectByName(NeonProvisioner.tenantProjectName(state.slug));
  if (project?.projectId !== state.database) throw new Error("UAT conflict database changed");
  await withDatabase(state.database, async client => {
    const { rows } = await client.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name='schema_migrations' order by ordinal_position");
    if (rows.length !== 1 || rows[0].column_name !== "uat_conflict" || rows[0].data_type !== "boolean") throw new Error("UAT conflict table changed");
    await client.query("drop table public.schema_migrations");
  });
  const { rows } = await db.query("select 1 from tenants where slug=$1", [state.slug]);
  if (rows.length) await writeFile(recordPath(root), JSON.stringify({ ...state, phase: "cleared" }), { mode: 0o600 });
  else { await provisioner.deleteProject(state.database); await rm(recordPath(root), { force: true }); }
  return { cleared: true, slug: state.slug, next: "Use the product's Retry action, or wait for its queued retry." };
}

export const resetControlState = root => rm(recordPath(root), { force: true });
