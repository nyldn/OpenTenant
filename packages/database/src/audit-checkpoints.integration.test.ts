import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgAuditStore } from "./audit-store";
import { anchorAuditScopes, verifyAuditCheckpoints } from "./audit-checkpoints";
import { FileCheckpointSink } from "@opentenant/security/checkpoint-sinks";
const url = process.env.AUDIT_CHECKPOINT_DATABASE_URL;
if (url && (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || new URL(url).pathname !== '/opentenant_it_audit')) throw new Error("audit proof requires its isolated loopback database");
const key = generateKeyPairSync("ed25519");
const keys = { test: key.publicKey };
const origin = "example.test/audit/installation-test";
(url ? describe : describe.skip)("external audit checkpoints against PostgreSQL", () => {
  const pool = new Pool({ connectionString: url });
  let dir: string;
  let sink: FileCheckpointSink;
  beforeAll(async () => {
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade; create schema public");
    const directory = new URL('../../../tooling/migrations/sql/control-plane/', import.meta.url);
    for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(name, directory), 'utf8'));
    await pool.query("insert into tenants (tenant_id, slug, display_name, status, data_region) values ('tenant_a','tenant-a','Example Organisation','active','eu')");
  });
  beforeEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(join(tmpdir(), "audit-pg-")); sink = new FileCheckpointSink(dir);
    // An owner attacker can disable triggers. The external verifier must still
    // find the attack after database-local controls have been bypassed.
    await pool.query("alter table audit_events disable trigger user; delete from audit_events; alter table audit_events enable trigger user");
    const store = new PgAuditStore(pool);
    for (const tenantId of [null, 'tenant_a']) for (let i = 0; i < 3; i++) await store.append({ tenantId, occurredAt: new Date('2026-11-11T00:00:00Z'), actor: { kind: 'system', job: 'proof' }, action: `proof.${i}`, subject: 'synthetic', detail: {} });
    await anchorAuditScopes({ pool, sink, origin, keyId: 'test', privateKey: key.privateKey, publicKeys: keys });
  });
  afterAll(async () => { await pool.end(); if (dir) await rm(dir, { recursive: true, force: true }); });
  async function tamper(sql: string) {
    await pool.query("alter table audit_events disable trigger user");
    try { await pool.query(sql); } finally { await pool.query("alter table audit_events enable trigger user"); }
  }
  function cli(command: "anchor" | "verify" = "verify") {
    return spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./audit-cli.ts', import.meta.url)), command], { encoding: 'utf8', env: { ...process.env, AUDIT_DATABASE_URL: url, AUDIT_CHECKPOINT_ORIGIN: origin, AUDIT_CHECKPOINT_DIRECTORY: dir, AUDIT_CHECKPOINT_PUBLIC_KEYS: JSON.stringify({ test: key.publicKey.export({ type: 'spki', format: 'pem' }) }), AUDIT_CHECKPOINT_KEY_ID: 'test', AUDIT_CHECKPOINT_PRIVATE_KEY: command === 'anchor' ? String(key.privateKey.export({ type: 'pkcs8', format: 'pem' })) : 'must-never-appear-in-errors' } });
  }
  it("anchors every scope, persists signed notes, retries, and verifies from the CLI", async () => {
    expect(await verifyAuditCheckpoints({ pool, sink, origin, publicKeys: keys })).toBe(2);
    await anchorAuditScopes({ pool, sink, origin, keyId: 'test', privateKey: key.privateKey, publicKeys: keys });
    expect(await sink.read()).toHaveLength(2);
    expect((await pool.query('select count(*)::int as n from audit_checkpoints')).rows[0].n).toBe(2);
    const anchored = cli('anchor'); expect(anchored.status, anchored.stderr).toBe(0); expect(anchored.stdout).toContain('anchored 2 audit scopes');
    const result = cli(); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('verified 2 audit scopes');
  });
  it.each([
    ['dropped tail', "delete from audit_events where tenant_id = 'tenant_a' and sequence = 3", 'dropped_tail'],
    ['edited row', "update audit_events set action = 'private-content-must-not-leak' where tenant_id = 'tenant_a' and sequence = 2", 'hash_mismatch at sequence 2'],
    ['reordering', "update audit_events set sequence = sequence + 10 where tenant_id = 'tenant_a'; update audit_events set sequence = case sequence when 11 then 2 when 12 then 1 else 3 end where tenant_id = 'tenant_a'", 'previous_hash_mismatch at sequence 1'],
    ['entire scope deletion', "delete from audit_events where tenant_id = 'tenant_a'", 'dropped_tail'],
  ])('detects %s after an owner bypass, even if DB checkpoints are deleted', async (_name, sql, reason) => {
    await tamper(sql);
    await pool.query('alter table audit_checkpoints disable trigger user; delete from audit_checkpoints; alter table audit_checkpoints enable trigger user');
    await expect(verifyAuditCheckpoints({ pool, sink, origin, publicKeys: keys })).rejects.toThrow(reason);
    const result = cli(); expect(result.status).toBe(1); expect(result.stderr).toContain(reason);
    expect(result.stderr).not.toContain('must-not-leak'); expect(result.stderr).not.toContain('must-never'); expect(result.stderr).not.toContain(url!);
    await expect(anchorAuditScopes({ pool, sink, origin, keyId: 'test', privateKey: key.privateKey, publicKeys: keys })).rejects.toThrow(reason);
  });
  it('extends an anchored chain, requires a fresh head, and never signs a broken chain', async () => {
    await new PgAuditStore(pool).append({ tenantId: 'tenant_a', occurredAt: new Date(), actor: { kind: 'system', job: 'proof' }, action: 'proof.next', subject: 'synthetic', detail: {} });
    await expect(verifyAuditCheckpoints({ pool, sink, origin, publicKeys: keys })).rejects.toThrow('unanchored_tail');
    await anchorAuditScopes({ pool, sink, origin, keyId: 'test', privateKey: key.privateKey, publicKeys: keys });
    expect(await verifyAuditCheckpoints({ pool, sink, origin, publicKeys: keys })).toBe(2);
  });
  it('detects a fully rewritten self-consistent chain against its external head', async () => {
    await tamper("delete from audit_events where tenant_id = 'tenant_a'");
    for (let i = 0; i < 3; i++) await new PgAuditStore(pool).append({ tenantId: 'tenant_a', occurredAt: new Date(), actor: { kind: 'system', job: 'rewrite' }, action: 'rewritten', subject: 'synthetic', detail: {} });
    expect((await new PgAuditStore(pool).verifyChain('tenant_a')).intact).toBe(true);
    await expect(verifyAuditCheckpoints({ pool, sink, origin, publicKeys: keys })).rejects.toThrow('checkpoint_head_mismatch at sequence 3');
  });
  it('anchors an empty platform chain and verifies it', async () => {
    await tamper('delete from audit_events');
    await rm(dir, { recursive: true, force: true });
    await anchorAuditScopes({ pool, sink, origin, keyId: 'test', privateKey: key.privateKey, publicKeys: keys });
    expect(await verifyAuditCheckpoints({ pool, sink, origin, publicKeys: keys })).toBe(1);
  });
  it('fails closed with no external checkpoints', async () => {
    await rm(dir, { recursive: true, force: true });
    await expect(verifyAuditCheckpoints({ pool, sink, origin, publicKeys: keys })).rejects.toThrow('missing_checkpoint');
  });
  it('normalizes connection and configuration errors without echoing secrets', () => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./audit-cli.ts', import.meta.url)), 'verify'], { encoding: 'utf8', env: { ...process.env, AUDIT_DATABASE_URL: 'postgresql://secret:never-log@127.0.0.1:1/private', AUDIT_CHECKPOINT_PUBLIC_KEYS: 'secret-invalid-json' } });
    expect(result.status).toBe(1); expect(result.stderr).not.toContain('never-log'); expect(result.stderr).not.toContain('secret-invalid');
  });
});
