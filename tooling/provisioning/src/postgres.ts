import { createHash } from "node:crypto";
import { Client } from "pg";
import { type NeonProjectResult } from "./neon";
import { createAppRole } from "./app-role";

/** Operator-owned server. Region labels describe that server; no geographic routing occurs. */
export class PostgresProvisioner {
  constructor(private readonly adminConnection: string, private readonly region = "operator") {}
  private databaseName(slug: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw new Error("Invalid tenant database name");
    return `opentenant_${slug.slice(0, 30).replaceAll("-", "_")}_${createHash("sha256").update(slug).digest("hex").slice(0, 10)}`;
  }
  private checkedName(name: string): string {
    if (!/^opentenant_[a-z0-9_]{1,51}$/.test(name)) throw new Error("Invalid tenant database checkpoint");
    return name;
  }
  async findProjectByName(name: string): Promise<{ projectId: string; region: string } | null> {
    const prefix = "opentenant-tenant-";
    if (!name.startsWith(prefix)) throw new Error("Invalid tenant database name");
    const database = this.databaseName(name.slice(prefix.length));
    return this.admin(async client => {
      const result = await client.query("select 1 from pg_database where datname=$1", [database]);
      return result.rows.length ? { projectId: database, region: this.region } : null;
    });
  }
  async createTenantProject(slug: string, _dataRegion: string): Promise<NeonProjectResult> {
    const name = this.databaseName(slug);
    await this.admin(async client => {
      try { await client.query(`create database "${name}"`); }
      catch (error) { if ((error as { code?: string }).code !== "42P04") throw error; }
      await client.query(`revoke connect on database "${name}" from public`);
    });
    return { projectId: name, region: this.region, connectionUri: await this.getConnectionUri(name) };
  }
  async getConnectionUri(projectId: string): Promise<string> {
    const url = new URL(this.adminConnection);
    url.pathname = `/${this.checkedName(projectId)}`;
    return url.toString();
  }
  async deleteProject(projectId: string): Promise<void> {
    const name = this.checkedName(projectId);
    await this.admin(async client => {
      await client.query(`drop database if exists "${name}" with (force)`);
      await client.query(`drop role if exists "${name}_app"`);
    });
  }
  private async admin<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.adminConnection });
    try { await client.connect(); return await work(client); }
    catch { throw new Error("Postgres provisioning operation failed"); }
    finally { await client.end(); }
  }
}

/** Each database gets its own login. tenant_app remains the migration-granted group. */
export async function createPostgresAppRole(connectionUri: string) {
  const database = new URL(connectionUri).pathname.slice(1);
  if (!/^opentenant_[a-z0-9_]{1,51}$/.test(database)) throw new Error("Invalid tenant database name");
  return createAppRole(connectionUri, `${database}_app`);
}
