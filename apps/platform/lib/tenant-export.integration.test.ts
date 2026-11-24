import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { CredentialCipher } from "@opentenant/database";
import { applyMigrations } from "@opentenant/migrations";
import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { loadControlPlaneMigrations } from "../../../tooling/migrations/src/local.mjs";
import { exportTenant, downloadTenantExport, LocalTenantExportSink } from "./tenant-export";
import type { TenantWorkerJob } from "./tenant-worker-store";

const controlUrl = integrationDatabaseUrl("TENANT_WORKER_DATABASE_URL");
const tenantUrl = integrationDatabaseUrl("PROVISIONING_TENANT_DATABASE_URL");
const actor = { kind: "installation_owner" as const, userId: "user_export_proof" };
const tenantId = "tenant_export_bounds";
const otherId = "tenant_export_other";
const childProgram = `
import { exportTenant, LocalTenantExportSink } from './apps/platform/lib/tenant-export.ts';
import { withTenantDb } from './apps/platform/lib/tenant-db.ts';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
const mode = process.env.EXPORT_PROOF_MODE;
const sink = new LocalTenantExportSink();
await withTenantDb('${tenantId}', client => client.query('select 1'));
const warmId = randomUUID();
await exportTenant({id:warmId,tenant_id:'${otherId}',actor:${JSON.stringify(actor)}}, sink);
await sink.remove(warmId);
global.gc();
const baseline = process.memoryUsage().rss;
let peak = baseline, peakHeap = 0, peakExternal = 0;
const sample = () => { const memory = process.memoryUsage(); peak = Math.max(peak, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed); peakExternal = Math.max(peakExternal, memory.external); };
const timer = setInterval(sample, 5);
let logicalBytes = 0, archiveBytes = 0;
try {
  if (mode === 'materialized') {
    // Exact former tenant-table read, intentionally before its still larger
    // JSON.stringify/whole-Buffer stages. This is a conservative baseline.
    const rows = await withTenantDb('${tenantId}', async client => (await client.query({text:'select * from tenant_core.export_bounds',query_timeout:60000})).rows);
    sample();
    logicalBytes = rows.reduce((total, row) => total + Buffer.byteLength(row.payload), 0);
  } else {
    const id = randomUUID();
    await exportTenant({id,tenant_id:'${tenantId}',actor:${JSON.stringify(actor)}}, sink);
    const downloaded = await sink.read(id);
    archiveBytes = downloaded.byteLength;
    await pipeline(Readable.fromWeb(downloaded.body), createGunzip(), new Writable({ write(chunk, _encoding, callback) { logicalBytes += chunk.length; sample(); callback(); } }));
    await sink.remove(id);
  }
  sample();
  console.log(JSON.stringify({mode,baseline,peak,growth:peak-baseline,logicalBytes,archiveBytes,peakHeap,peakExternal,warmupBytes:8*1024**2,concurrency:1}));
} finally { clearInterval(timer); }
process.exit(0);
`;

(controlUrl && tenantUrl ? describe : describe.skip)("tenant export database bounds and memory", () => {
  const control = new Pool({ connectionString: controlUrl });
  const tenant = new Pool({ connectionString: tenantUrl });
  let directory: string;
  const role = `export_proof_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const key = randomBytes(32).toString("base64");
  let sink: LocalTenantExportSink;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "export-db-proof-")); sink = new LocalTenantExportSink(directory);
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", controlUrl!); vi.stubEnv("TENANT_DB_ENCRYPTION_KEY", key);
    vi.stubEnv("TENANT_EXPORT_DIRECTORY", directory);
    await applyMigrations(control, await loadControlPlaneMigrations());
    await tenant.query(`create role "${role}" login password '${password}' nosuperuser nobypassrls`);
    await tenant.query(`create schema tenant_core; create table tenant_core.export_bounds(tenant_id text not null, id integer not null, payload text not null, encrypted_credential text); alter table tenant_core.export_bounds enable row level security; alter table tenant_core.export_bounds force row level security; create policy export_tenant on tenant_core.export_bounds using (tenant_id=current_setting('app.tenant_id',true)); grant usage on schema tenant_core to "${role}"; grant select on tenant_core.export_bounds to "${role}"`);
    const restricted = new URL(tenantUrl!); restricted.username = role; restricted.password = password;
    for (const id of [tenantId, otherId]) {
      await control.query(`insert into tenants(tenant_id,slug,display_name,status,data_region) values ($1,$1,'Synthetic export tenant','active','us')`, [id]);
      await control.query(`insert into tenant_databases(tenant_id,provider,region,encrypted_connection) values ($1,'neon','synthetic',$2)`, [id, Buffer.from(new CredentialCipher(key).encrypt(restricted.href, id))]);
      await control.query(`insert into tenant_branding_assets(asset_id,tenant_id,display_name,mime_type,content) values ('asset_proof',$1,'Synthetic pixel','image/png',$2)`, [id, Buffer.from([0, 255, 128, 1])]);
    }
    await tenant.query(`insert into tenant_core.export_bounds values ($1,0,'own-row','synthetic-secret'),($2,0,'other-tenant-sentinel','other-secret')`, [tenantId, otherId]);
  }, 120000);
  afterAll(async () => {
    await tenant.query("drop schema if exists tenant_core cascade");
    await tenant.query(`drop role if exists "${role}"`);
    await Promise.all([control.end(), tenant.end()]);
    const shared = globalThis as typeof globalThis & { [key: symbol]: Pool | undefined };
    await shared[Symbol.for("opentenant.control-plane-pool")]?.end(); delete shared[Symbol.for("opentenant.control-plane-pool")];
    await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs();
  });
  const job = () => ({ id: randomUUID(), tenant_id: tenantId, actor } as TenantWorkerJob);
  it("retains restricted-role RLS, tenant binding, redaction, branding bytes and 24-hour expiry", async () => {
    const work = job(); await exportTenant(work, sink);
    const archive = join(directory, `${work.id}.tar.gz`);
    const extract = async (entry: string) => JSON.parse((await promisify(execFile)("tar", ["-xOzf", archive, entry])).stdout);
    expect(await extract("tenant.tenant_core.export_bounds.json")).toEqual([{ id: 0, payload: "own-row", tenant_id: tenantId }]);
    expect((await extract("control.tenant_databases.json"))[0]).not.toHaveProperty("encrypted_connection");
    const asset = (await extract("control.tenant_branding_assets.json"))[0];
    expect(asset.content_encoding).toBe("base64"); expect(Buffer.from(asset.content_base64, "base64")).toEqual(Buffer.from([0, 255, 128, 1])); expect(asset).not.toHaveProperty("content");
    expect(await downloadTenantExport(otherId, work.id, actor, sink)).toBeNull();
    const expiry = (await control.query("select extract(epoch from expires_at-created_at) as seconds from tenant_export_archives where id=$1 and tenant_id=$2", [work.id, tenantId])).rows[0];
    expect(Number(expiry.seconds)).toBe(86400);
    await control.query("update tenant_export_archives set expires_at=now()-interval '1 second' where id=$1", [work.id]);
    expect(await downloadTenantExport(tenantId, work.id, actor, sink)).toBeNull(); await sink.remove(work.id);
  });
  it("leaves no file or download authority after a bound failure or cancellation and audits no content", async () => {
    for (const options of [{ limits: { maxBytes: 1 } }, { signal: AbortSignal.abort() }]) {
      const work = job(); await expect(exportTenant(work, sink, options)).rejects.toThrow("Tenant export");
      expect((await control.query("select id from tenant_export_archives where id=$1", [work.id])).rowCount).toBe(0);
    }
    expect(await readdir(directory)).toEqual([]);
    const audits = (await control.query("select detail from audit_events where tenant_id=$1 and action='tenant.export_failed'", [tenantId])).rows;
    expect(audits).toHaveLength(2); expect(JSON.stringify(audits)).not.toMatch(/own-row|synthetic-secret|other-tenant-sentinel/);
  });
  it("keeps RSS growth below 128 MiB for a 1 GiB logical tenant and far below whole-table reads", async () => {
    await tenant.query("delete from tenant_core.export_bounds where tenant_id=$1", [tenantId]);
    await tenant.query("insert into tenant_core.export_bounds(tenant_id,id,payload) select $1,i,repeat(md5(i::text),2048) from generate_series(1,16384) i", [tenantId]);
    await tenant.query("insert into tenant_core.export_bounds(tenant_id,id,payload) select $1,i,repeat(md5(i::text),2048) from generate_series(1,128) i", [otherId]);
    const measurements = [];
    for (const mode of ["materialized", "streamed"]) {
      const { stdout } = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--expose-gc", "--max-old-space-size=4096", "--import", "./tooling/provisioning/register.mjs", "--input-type=module", "-e", childProgram], { cwd: resolve(import.meta.dirname, "../../.."), env: { ...process.env, EXPORT_PROOF_MODE: mode }, timeout: 15 * 60_000, maxBuffer: 8192 });
      measurements.push(JSON.parse(stdout.trim().split("\n").at(-1)!));
    }
    console.log("EXPORT_RSS_PROOF", JSON.stringify(measurements));
    expect(measurements[1].logicalBytes).toBeGreaterThanOrEqual(1024 ** 3);
    expect(measurements[1].growth).toBeLessThanOrEqual(128 * 1024 ** 2);
    expect(measurements[1].growth).toBeLessThan(measurements[0].growth / 4);
    expect(measurements[1].archiveBytes).toBeGreaterThan(0);
    expect((await readdir(directory)).filter(name => name.startsWith(".export-"))).toEqual([]);
  }, 20 * 60_000);
});
