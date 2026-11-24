/** Operator-only schema compiler. Emits reviewable SQL; never edits migration history. */
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";
import { betterAuthOptions } from "./runtime";
const connectionString = process.env.BETTER_AUTH_MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("A disposable migration database is required");
let target: URL;
try { target = new URL(connectionString); }
catch { throw new Error("Invalid disposable migration database URL"); }
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !target.pathname.startsWith("/opentenant_it_")) {
  throw new Error("Migration compilation requires a loopback opentenant_it_ database");
}
const pool = new Pool({ connectionString });
try {
  const plan = await getMigrations(betterAuthOptions(pool, {
    secret: "migration-compiler-only-placeholder-32-characters", baseURL: "http://localhost:3000", production: false,
  }));
  process.stdout.write("-- Review this SQL and reserve a NEW forward migration before saving it.\n" + await plan.compileMigrations() + "\n");
} finally { await pool.end(); }
