import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURE_VERSION } from "./brand-assets.mjs";
export async function fixtureSnapshot({ container, directory }) {
  const exec = args => execFileSync("docker", ["exec", container, ...args], { encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const sql = query => exec(["psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", query]).trim().split("\n").filter(Boolean);
  const databases = () => sql("select datname from pg_database where not datistemplate and datname <> 'postgres' order by datname");
  const names = databases();
  const roles = sql("select rolname from pg_roles order by rolname");
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  for (const [i,name] of names.entries()) exec(["pg_dump", "-U", "postgres", "-Fc", "--create", "-f", `/tmp/uat-seed-${i}.dump`, name]);
  const digest = () => names.map(name => exec(["pg_dump", "-U", "postgres", "--data-only", "--inserts", "--exclude-schema=graphile_worker", name]).split("\n").filter(line => line.startsWith("INSERT INTO") || line.startsWith("SELECT pg_catalog.setval")).sort().join("\n")).join("\n");
  const initial = digest();
  await writeFile(join(directory, "fixture-snapshot.json"), JSON.stringify({ version: 2, fixtureVersion: FIXTURE_VERSION, names, roles }), { mode: 0o600 });
  return {
    async verify() { if (digest() !== initial || JSON.stringify(databases()) !== JSON.stringify(names)) throw new Error("Fixture snapshot differs from seed"); return true; },
    async restore() {
      sql("select pg_terminate_backend(pid) from pg_stat_activity where datname <> 'postgres' and pid <> pg_backend_pid()");
      for (const name of databases()) sql(`drop database ${quote(name)} with (force)`);
      for (const role of sql("select rolname from pg_roles order by rolname").filter(r => !roles.includes(r))) sql(`drop role ${quote(role)}`);
      for (const [i] of names.entries()) exec(["pg_restore", "-U", "postgres", "--exit-on-error", "--create", "-d", "postgres", `/tmp/uat-seed-${i}.dump`]);
    },
  };
}
