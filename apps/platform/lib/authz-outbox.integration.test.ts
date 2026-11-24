import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenFgaAuthorization } from "@opentenant/authz/openfga";
import type { AuthorizationContext } from "@opentenant/authz";
import { SyntheticFga } from "../../../packages/authz/src/testing/synthetic-fga";
import { acknowledgedAuthorizationContext, queueEntitlementSync, queueManifestPublication, queueMembershipSync } from "./authz-lifecycle";
import { claimAuthorizationEvent, deliverAuthorizationEvent, enqueueAuthorizationChange, finishAuthorizationEvent, runAuthorizationOutbox, type AuthorizationChange } from "./authz-outbox";
const installed = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../opentenant-modules", () => ({ installedModules: installed }));
const url = process.env.CONTROL_PLANE_INTEGRATION_DATABASE_URL;
const schema = `authz_proof_${randomUUID().replaceAll("-", "")}`;
let pool: Pool;
const manifest: AuthorizationContext["manifest"] = { key: "example", version: "1", runtime: "native", navigation: [], permissions: ["example.use", "example.edit"], rolePermissions: { tenant_owner: ["example.use", "example.edit"], tenant_admin: ["example.use", "example.edit"], tenant_member: ["example.use"] } };
const member: AuthorizationChange = { kind: "membership", userId: "user_a", role: "tenant_admin", active: true };
const entitlement: AuthorizationChange = { kind: "entitlement", moduleKey: "example", enabled: true, manifest };
const request = { tenantId: "ten_a", userId: "user_a", moduleKey: "example" };
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("begin"); const result = await work(client); await client.query("commit"); return result; }
  catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
async function enqueue(change: AuthorizationChange, tenantId = "ten_a") { await transaction(client => enqueueAuthorizationChange(client, tenantId, change)); }
function adapter(fga: SyntheticFga) {
  return new OpenFgaAuthorization({ apiUrl: "http://127.0.0.1:1", storeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", authorizationModelId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, {
    loadContext: async input => {
      const context = await acknowledgedAuthorizationContext(pool, input);
      return context ? { ...context, entitled: true } : null;
    },
  }, fga.client);
}
async function retryNow() { await pool.query("update authorization_outbox set available_at=now() where tenant_id='ten_a'"); }

describe.skipIf(!url)("durable tenant authorization outbox", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !parsed.pathname.startsWith("/opentenant_it_")) throw new Error("Synthetic loopback database required");
    const admin = new Pool({ connectionString: url });
    try { await admin.query(`create schema ${schema}`); } finally { await admin.end(); }
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 5 });
    await pool.query("create table tenants (tenant_id text primary key); insert into tenants values ('ten_a'),('ten_b')");
    await pool.query("create table module_catalog (module_key text primary key, authorization_manifest jsonb); create table tenant_modules (tenant_id text, module_key text, enabled boolean)");
    await pool.query(await readFile(new URL("../../../tooling/migrations/sql/control-plane/0084_authorization_outbox.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { if (pool) { await pool.query(`drop schema ${schema} cascade`); await pool.end(); } });
  beforeEach(async () => {
    installed.get.mockReset();
    await pool.query("truncate authorization_outbox, authorization_sync_state, authorization_sync_streams, tenant_modules, module_catalog");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("commits mutation and outbox together, rolls back both and deduplicates replay", async () => {
    await pool.query("create table synthetic_mutations (id text primary key)");
    await expect(transaction(async client => {
      await client.query("insert into synthetic_mutations values ('mutation')");
      await enqueueAuthorizationChange(client, "ten_a", member);
      throw new Error("synthetic rollback");
    })).rejects.toThrow("rollback");
    expect((await pool.query("select * from synthetic_mutations")).rowCount).toBe(0);
    expect((await pool.query("select * from authorization_outbox")).rowCount).toBe(0);
    await enqueue(member); await enqueue(member);
    expect((await pool.query("select * from authorization_outbox")).rowCount).toBe(1);
    await pool.query("drop table synthetic_mutations");
  });
  it("initializes invitation acceptance once and never resurrects an explicit removal", async () => {
    await transaction(client => enqueueAuthorizationChange(client, "ten_a", member, { initializeOnly: true }));
    await enqueue({ ...member, active: false });
    await transaction(client => enqueueAuthorizationChange(client, "ten_a", member, { initializeOnly: true }));
    const { rows } = await pool.query("select payload from authorization_sync_state where tenant_id='ten_a'");
    expect(rows[0].payload.active).toBe(false);
    expect((await pool.query("select * from authorization_outbox")).rowCount).toBe(2);
  });
  it("allows one lease, blocks later events, recovers expiry and fences stale acknowledgements", async () => {
    await enqueue(member); await enqueue(entitlement);
    const claims = await Promise.all([claimAuthorizationEvent(pool, "ten_a"), claimAuthorizationEvent(pool, "ten_a")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    expect(await claimAuthorizationEvent(pool, "ten_a")).toBeNull();
    await pool.query("update authorization_outbox set lease_until=now()-interval '1 second' where tenant_id=$1 and sequence=$2", [first.tenant_id, first.sequence]);
    const recovered = await claimAuthorizationEvent(pool, "ten_a");
    expect(recovered?.sequence).toBe(first.sequence); expect(recovered?.lease_token).not.toBe(first.lease_token);
    expect(await transaction(client => finishAuthorizationEvent(client, first, true))).toBe(false);
    expect(await transaction(client => finishAuthorizationEvent(client, recovered!, true))).toBe(true);
    expect((await claimAuthorizationEvent(pool, "ten_a"))?.kind).toBe("entitlement");
  });
  it("denies revoked authority throughout outage and retry, with no lost work", async () => {
    const fga = new SyntheticFga(); const port = adapter(fga);
    await enqueue(member); await enqueue(entitlement);
    expect((await runAuthorizationOutbox({ pool, tenantId: "ten_a", port })).delivered).toBe(2);
    expect(await port.listPermissions(request)).toContain("example.edit");
    await enqueue({ ...member, role: "tenant_member" });
    fga.offline = true;
    expect((await runAuthorizationOutbox({ pool, tenantId: "ten_a", port })).failed).toBe(1);
    expect(await port.listPermissions(request)).toEqual([]);
    fga.offline = false;
    // Old remote tuples are still present, but the local fence denies them.
    expect(await port.listPermissions(request)).toEqual([]);
    await retryNow(); fga.loseAcknowledgement = true;
    expect((await runAuthorizationOutbox({ pool, tenantId: "ten_a", port })).failed).toBe(1);
    expect(await port.listPermissions(request)).toEqual([]);
    await retryNow();
    expect((await runAuthorizationOutbox({ pool, tenantId: "ten_a", port })).delivered).toBe(1);
    expect(await port.listPermissions(request)).toEqual(["example.use"]);
    await enqueue({ ...entitlement, enabled: false }); fga.offline = true;
    await runAuthorizationOutbox({ pool, tenantId: "ten_a", port }); fga.offline = false;
    expect(await port.listPermissions(request)).toEqual([]);
    await retryNow(); await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    expect(await port.listPermissions(request)).toEqual([]);
  });
  it("keeps a successful but unacknowledged grant fenced until idempotent retry", async () => {
    const fga = new SyntheticFga(); const port = adapter(fga);
    await enqueue(member); await enqueue(entitlement);
    fga.loseWriteAcknowledgement = true;
    expect((await runAuthorizationOutbox({ pool, tenantId: "ten_a", port })).failed).toBe(1);
    expect(await port.listPermissions(request)).toEqual([]);
    await retryNow();
    expect((await runAuthorizationOutbox({ pool, tenantId: "ten_a", port })).delivered).toBe(2);
    expect(await port.listPermissions(request)).toContain("example.edit");
  });
  it("orders concurrent role change then removal and suppresses obsolete replacement", async () => {
    const fga = new SyntheticFga(); const port = adapter(fga);
    await enqueue(member); await enqueue(entitlement); await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    const changing = await pool.connect();
    await changing.query("begin");
    await enqueueAuthorizationChange(changing, "ten_a", { ...member, role: "tenant_member" });
    let attempted!: () => void;
    const started = new Promise<void>(resolve => { attempted = resolve; });
    const removing = transaction(async client => {
      attempted();
      await enqueueAuthorizationChange(client, "ten_a", { ...member, active: false });
    });
    try {
      await started;
      await changing.query("commit");
      await removing;
    } finally { changing.release(); }
    fga.operations.length = 0;
    await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    expect(fga.operations).toEqual(["revoke", "revoke"]);
    expect(await port.listPermissions(request)).toEqual([]);
    const { rows } = await pool.query("select sequence, completed_at from authorization_outbox where tenant_id='ten_a' order by sequence");
    expect(rows.map(row => Number(row.sequence))).toEqual([1, 2, 3, 4]); expect(rows.every(row => row.completed_at)).toBe(true);
  });
  it("fences an in-flight write after removal, recovery and a late acknowledgement", async () => {
    const fga = new SyntheticFga(); const port = adapter(fga);
    await enqueue(member); await enqueue(entitlement); await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    await enqueue({ ...member, role: "tenant_owner" });
    const stale = (await claimAuthorizationEvent(pool, "ten_a"))!;
    await enqueue({ ...member, active: false });
    await pool.query("update authorization_outbox set lease_until=now()-interval '1 second' where tenant_id='ten_a' and lease_token is not null");
    await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    await port.writeRelationships({ tenantId: "ten_a", relationships: [{ kind: "membership", userId: "user_a", role: "tenant_owner", version: stale.version }] });
    expect(await transaction(client => finishAuthorizationEvent(client, stale, true))).toBe(false);
    expect(await port.listPermissions(request)).toEqual([]);
  });
  it("isolates tenant streams, states, retries and relationships for a shared user", async () => {
    const fga = new SyntheticFga(); const port = adapter(fga);
    for (const tenantId of ["ten_a", "ten_b"]) {
      await enqueue(member, tenantId); await enqueue(entitlement, tenantId);
      await runAuthorizationOutbox({ pool, tenantId, port });
    }
    await enqueue({ ...member, active: false });
    await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    expect(await port.listPermissions(request)).toEqual([]);
    expect(await port.listPermissions({ ...request, tenantId: "ten_b" })).toContain("example.edit");
  });
  it("publishes immutable manifest snapshots and does not regrant removed permissions on retry", async () => {
    const fga = new SyntheticFga(); const port = adapter(fga);
    await enqueue(member); await enqueue(entitlement); await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    await enqueue({ ...entitlement, manifest: { ...manifest, version: "2", rolePermissions: { tenant_admin: ["example.use"] } } });
    expect(await port.listPermissions(request)).toEqual([]);
    await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    expect(await port.listPermissions(request)).toEqual(["example.use"]);
    // Replay an old envelope after the new snapshot was acknowledged.
    const old = (await pool.query("select * from authorization_outbox where tenant_id='ten_a' and kind='entitlement' order by sequence limit 1")).rows[0];
    await deliverAuthorizationEvent(pool, port, old);
    expect(await port.listPermissions(request)).toEqual(["example.use"]);
  });
  it("preserves published revocations during reconciliation and caps catalog grants at installed role permissions", async () => {
    vi.stubEnv("AUTHZ_PROVIDER", "openfga");
    vi.stubEnv("OPENFGA_API_URL", "http://127.0.0.1:1");
    vi.stubEnv("OPENFGA_STORE_ID", "01ARZ3NDEKTSV4RRFFQ69G5FAV");
    vi.stubEnv("OPENFGA_MODEL_ID", "01ARZ3NDEKTSV4RRFFQ69G5FAV");
    installed.get.mockReturnValue({ manifest });
    const port = adapter(new SyntheticFga());
    await transaction(async client => {
      await client.query("insert into module_catalog values ($1,$2)", [manifest.key, manifest]);
      await client.query("insert into tenant_modules values ('ten_a',$1,true)", [manifest.key]);
      await queueMembershipSync(client, { tenantId: "ten_a", userId: "user_a", role: "tenant_admin", active: true });
      await queueEntitlementSync(client, { tenantId: "ten_a", moduleKey: manifest.key });
    });
    await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    expect(await port.listPermissions(request)).toContain("example.edit");
    const published = { ...manifest, version: "2", permissions: [...manifest.permissions, "example.publish"], rolePermissions: {
      tenant_owner: ["example.use", "example.edit", "example.publish"], tenant_admin: ["example.use"], tenant_member: ["example.use", "example.edit", "example.publish"],
    } };
    await transaction(async client => {
      await client.query("update module_catalog set authorization_manifest=$1 where module_key=$2", [published, manifest.key]);
      await queueManifestPublication(client, published);
    });
    expect(await port.listPermissions(request)).toEqual([]);
    await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
    expect(await port.listPermissions(request)).toEqual(["example.use"]);
    await transaction(client => queueEntitlementSync(client, { tenantId: "ten_a", moduleKey: manifest.key }));
    expect((await pool.query("select * from authorization_outbox where completed_at is null")).rowCount).toBe(0);
    expect(await port.listPermissions(request)).toEqual(["example.use"]);
    // A reader overlapping publication must read the committed restriction,
    // rather than enqueue an older catalog snapshot after the publisher.
    const publisher = await pool.connect();
    const reader = await pool.connect();
    try {
      const publisherPid = (await publisher.query("select pg_backend_pid() as pid")).rows[0].pid;
      const readerPid = (await reader.query("select pg_backend_pid() as pid")).rows[0].pid;
      await publisher.query("begin");
      const restricted = { ...published, version: "3", rolePermissions: { tenant_admin: [], tenant_member: ["example.use"], tenant_owner: ["example.use", "example.edit", "example.publish"] } };
      await publisher.query("update module_catalog set authorization_manifest=$1 where module_key=$2", [restricted, manifest.key]);
      await queueManifestPublication(publisher, restricted);
      await reader.query("begin");
      const reconciliation = queueEntitlementSync(reader, { tenantId: "ten_a", moduleKey: manifest.key });
      try {
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const { rows } = await pool.query("select $1::int = any(pg_blocking_pids($2::int)) as blocked", [publisherPid, readerPid]);
          if (rows[0].blocked) { blocked = true; break; }
        }
        expect(blocked).toBe(true);
      } finally { await publisher.query("commit"); }
      await reconciliation;
      await reader.query("commit");
      await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
      expect(await port.listPermissions(request)).toEqual([]);
    } finally {
      await publisher.query("rollback"); await reader.query("rollback");
      publisher.release(); reader.release();
    }
    for (const [role, expected] of [["tenant_member", ["example.use"]], ["tenant_owner", ["example.use", "example.edit"]]] as const) {
      await transaction(client => queueMembershipSync(client, { tenantId: "ten_a", userId: "user_a", role, active: true }));
      await runAuthorizationOutbox({ pool, tenantId: "ten_a", port });
      expect(await port.listPermissions(request)).toEqual(expected);
    }
  });
});
