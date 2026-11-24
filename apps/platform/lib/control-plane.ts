import { serverConfig } from "./server-config";
import { processSingleton } from "@opentenant/platform-core/runtime-globals";
/** Shared, observable control-plane database access for reusable consumers. */
import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient } from "pg";

const POOL_KEY = Symbol.for("opentenant.control-plane-pool");

export class ControlPlaneCommitError extends Error {
  constructor(cause: unknown) {
    super("Control-plane transaction commit outcome is unknown", { cause });
    this.name = "ControlPlaneCommitError";
  }
}

export function controlPlanePool(): Pool {
  return processSingleton(POOL_KEY, () => {
    const connectionString = serverConfig().CONTROL_PLANE_DATABASE_URL;
    if (!connectionString) throw new Error("Missing CONTROL_PLANE_DATABASE_URL");
    const pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
    });
    attachDatabasePool(pool);
    return pool;
  });
}

export async function withControlPlaneTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  pool: Pick<Pool, "connect"> = controlPlanePool(),
): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  let committing = false;
  try {
    await client.query("begin");
    const result = await work(client);
    committing = true;
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error
        ? rollbackError
        : new Error("Control-plane transaction rollback failed", { cause: rollbackError });
    }
    throw committing ? new ControlPlaneCommitError(error) : error;
  } finally {
    if (releaseError) client.release(releaseError);
    else client.release();
  }
}
