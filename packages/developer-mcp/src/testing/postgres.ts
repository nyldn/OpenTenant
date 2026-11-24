import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "@opentenant/migrations";

/** Each suite owns a distinct database inside the disposable db:ephemeral server. */
export async function proofDatabase(source: string | undefined) {
  if (!source) throw new Error("Run this proof through pnpm db:ephemeral");
  const url = new URL(source);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Proof requires loopback");
  const name = `opentenant_it_mcp_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: source, max: 1 });
  await admin.query(`create database ${name}`);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  // The db:ephemeral controller owns database destruction after the test process exits.
  // Forcing DROP DATABASE immediately after pool.end can interrupt closing pg sockets.
  return { pool, async close() { await pool.end(); await admin.end(); } };
}
export async function migrateControl(pool: Pool) {
  const { loadControlPlaneMigrations } = await import("@opentenant/migrations/control-plane");
  await applyMigrations(pool, await loadControlPlaneMigrations());
}
