import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { Pool } from "pg";

export async function withControl<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
  const db = new Pool({ connectionString: process.env.CONTROL_PLANE_DATABASE_URL });
  try { return await work(db); } finally { await db.end(); }
}

export async function workerOnce() {
  await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "./tooling/provisioning/register.mjs", "apps/platform/workflows/worker.ts", "--once"], {
    cwd: resolve(import.meta.dirname, "../../.."), env: process.env, timeout: 120_000,
  });
}
