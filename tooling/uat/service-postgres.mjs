import { createRequire } from "node:module";
import { cleanupServiceDatabases } from "../e2e/service-cleanup.mjs";
import { postgresPort } from "../e2e/safety.mjs";
const { Pool } = createRequire(new URL("../e2e/package.json", import.meta.url))("pg");
export async function startServicePostgres(runId) {
  if (!/^[a-f0-9]{24}$/.test(runId)) throw new Error("Invalid run id");
  const port = await postgresPort(process.env.E2E_POSTGRES_PORT);
  const password = process.env.E2E_SERVICE_PASSWORD;
  if (!password) throw new Error("Service Postgres requires E2E_SERVICE_PASSWORD");
  const adminUrl = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
  const appUrl = new URL(`/opentenant_it_e2e_${runId}`, adminUrl).href;
  const db = new Pool({ connectionString: adminUrl });
  try {
    if (!(await db.query("show server_version_num")).rows[0].server_version_num.startsWith("17")) throw new Error("Postgres 17 required");
    if ((await db.query("select name from pg_available_extensions where name='vector'")).rowCount !== 1) throw new Error("pgvector required");
    await db.query(`create database opentenant_it_e2e_${runId}`);
  } finally { await db.end(); }
  return { adminUrl, appUrl, port, dispose: () => cleanupServicePostgres(appUrl) };
}

export async function cleanupServicePostgres(controlUrl) {
  const parsed = new URL(controlUrl), name = parsed.pathname.slice(1);
  if (!/^opentenant_it_e2e_[a-f0-9]+$/.test(name) || parsed.hostname !== "127.0.0.1") throw new Error("Unsafe service cleanup target");
  const db = new Pool({ connectionString: new URL("/postgres", parsed).href });
  let exists;
  try { exists = (await db.query("select 1 from pg_database where datname=$1", [name])).rowCount === 1; }
  finally { await db.end(); }
  if (exists) await cleanupServiceDatabases(controlUrl);
}
