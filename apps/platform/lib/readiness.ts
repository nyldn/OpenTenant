import { Client } from "pg";
import { serverConfig } from "./server-config";

export async function controlPlaneReady(): Promise<boolean> {
  let client: Client | undefined;
  try {
    const connectionString = serverConfig().CONTROL_PLANE_DATABASE_URL;
    if (!connectionString) throw new Error("Database unavailable");
    client = new Client({ connectionString, connectionTimeoutMillis: 750, query_timeout: 750, statement_timeout: 750 });
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client?.end().catch(() => undefined);
  }
}
