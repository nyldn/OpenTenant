import { createRequire } from "node:module";
import { PostgresProvisioner } from "../provisioning/dist/index.js";
import { guardDatabase } from "./control-guard.mjs";
import { parseCommand } from "./control.mjs";
import { expireExports } from "./export-control.mjs";
import { armProvisionConflict, clearProvisionConflict, provisionControlStatus } from "./provision-control.mjs";
const { Pool } = createRequire(new URL("../e2e/package.json", import.meta.url))("pg");

export async function runOperatorControl({ root, runId, database }, input) {
  const command = parseCommand([input.action, ...(input.slug === undefined ? [] : [input.slug])]);
  await guardDatabase(root, runId, database);
  const db = new Pool({ connectionString: database.controlUrl, connectionTimeoutMillis: 5000, query_timeout: 30_000, max: 1 });
  const withDatabase = async (name, work) => {
    if (!/^opentenant_[a-z0-9_]{1,51}$/.test(name)) throw new Error("Invalid UAT database");
    const target = new Pool({ connectionString: new URL(`/${name}`, database.adminUrl).href, connectionTimeoutMillis: 5000, query_timeout: 30_000, max: 1 });
    try { return await work(target); } finally { await target.end(); }
  };
  const context = { root, runId, db, withDatabase, provisioner: new PostgresProvisioner(database.adminUrl, "synthetic-eu") };
  try {
    const result = command.action === "fail-next-provision" ? await armProvisionConflict(context, command.slug)
      : command.action === "clear" ? await clearProvisionConflict(context)
        : command.action === "expire-exports" ? await expireExports(context, command.slug)
        : { provision: await provisionControlStatus(context) };
    return { runId, ...result };
  } finally { await db.end(); }
}
