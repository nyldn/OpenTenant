import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import "./register.mjs";

function argumentsFor(args) {
  const [mode, ...rest] = args;
  if (!["control-plane", "tenant-fleet"].includes(mode)) throw new Error("Invalid migration arguments");
  const options = { mode, targets: [], dryRun: false, manifest: null, canary: null };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--dry-run") options.dryRun = true;
    else if (["--target", "--manifest", "--canary"].includes(flag) && rest[i + 1] && !rest[i + 1].startsWith("--")) {
      const value = rest[++i];
      if (flag === "--target") options.targets.push(value);
      else options[flag.slice(2)] = value;
    } else throw new Error("Invalid migration arguments");
  }
  if (!options.targets.length) throw new Error("Explicit --target host confirmation is required");
  return options;
}

function checkedUrl(value, targets) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid database URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error("Invalid database URL");
  // pg accepts query-string host/port overrides. Only TLS settings are supported.
  const tlsOptions = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey"]);
  if ([...url.searchParams.keys()].some((key) => !tlsOptions.has(key))) throw new Error("Unsupported database URL connection options");
  // Include port when present. No connection is made until every host is confirmed.
  if (!targets.includes(url.host)) throw new Error("Database host does not match a confirmed --target");
  return value;
}

export async function runHosted({ args = process.argv.slice(2), env = process.env,
  poolFactory = (connectionString) => new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }),
  log = console.log,
} = {}) {
  const options = argumentsFor(args);
  let targets;
  if (options.mode === "control-plane") {
    targets = [{ tenantId: "control-plane", databaseUrl: checkedUrl(env.CONTROL_PLANE_DATABASE_URL, options.targets) }];
  } else {
    if (!options.manifest || !options.canary) throw new Error("Tenant fleet requires --manifest and --canary");
    let manifest;
    try { manifest = JSON.parse(await readFile(options.manifest, "utf8")); }
    catch { throw new Error("Invalid fleet manifest"); }
    if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("Invalid fleet manifest");
    targets = manifest.map((item) => {
      if (!item || !/^[a-zA-Z0-9_-]{1,80}$/u.test(item.tenantId)) throw new Error("Invalid fleet tenant identifier");
      return { tenantId: item.tenantId, databaseUrl: checkedUrl(item.databaseUrl, options.targets) };
    });
    if (new Set(targets.map((item) => item.tenantId)).size !== targets.length) throw new Error("Duplicate fleet tenant identifier");
    const canary = targets.find((item) => item.tenantId === options.canary);
    if (!canary) throw new Error("Canary is not in the fleet manifest");
    targets = [canary, ...targets.filter((item) => item !== canary)];
  }
  const { applyMigrations, pendingMigrations } = await import("./runner.ts");
  const { loadControlPlaneMigrations } = await import("./local.mjs");
  const { TENANT_CORE_MIGRATIONS, migrateTenantCore } = await import("./tenant-core.ts");
  const { TENANT_MODULE_CATALOGS, migrateTenantModules } = await import("./tenant-modules.ts");
  const { installedModules } = await import("../../../apps/platform/opentenant-modules.ts");
  const catalogs = options.mode === "control-plane" ? [await loadControlPlaneMigrations(), ...installedModules.migrations.controlPlane]
    : [TENANT_CORE_MIGRATIONS, ...TENANT_MODULE_CATALOGS];
  for (const [index, target] of targets.entries()) {
    log(`[${index + 1}/${targets.length}] ${target.tenantId} starting${options.dryRun ? " dry-run" : ""}`);
    let pool;
    try {
      pool = poolFactory(target.databaseUrl);
      const pending = [];
      for (const catalog of catalogs) pending.push(...await pendingMigrations(pool, catalog));
      log(`${target.tenantId} pending: ${pending.join(", ") || "none"}`);
      if (!options.dryRun) {
        if (options.mode === "control-plane") {
          for (const catalog of catalogs) await applyMigrations(pool, catalog);
          const { seedModuleCatalog } = await import("@opentenant/platform-core");
          const client = await pool.connect();
          try {
            await client.query("begin");
            await seedModuleCatalog(installedModules, client);
            await client.query("commit");
          } catch (error) { await client.query("rollback"); throw error; }
          finally { client.release(); }
        }
        else { await migrateTenantCore(pool); await migrateTenantModules(pool); }
      }
      log(`${target.tenantId} ${options.dryRun ? "planned" : "completed"}`);
    } catch {
      log(`${target.tenantId} failed; rollout stopped`);
      throw new Error("Hosted migration failed; inspect the database with approved operator tooling");
    } finally { await pool?.end().catch(() => undefined); }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runHosted().catch(() => { console.error("Hosted migration command failed. Check arguments, configuration, and database migration state."); process.exitCode = 1; });
}
