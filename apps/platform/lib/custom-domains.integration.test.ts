import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { applyMigrations } from "@opentenant/migrations";
import type { TxtResolver } from "./custom-domains";
import { addCustomDomain, reissueCustomDomain, removeCustomDomain, verifyCustomDomain } from "./custom-domains";
import { tenantBrandingAssets, tenantOwnsBrandingAsset, readTenantBrandingAsset } from "./tenant-branding-assets";
import { verifiedCustomTenantForHost } from "./custom-domains-resolution";
import { recheckCustomDomain, runCustomDomainRechecks, selectDueCustomDomains } from "./custom-domains-job";
import { PgAuditStore } from "@opentenant/database";

const connectionString = process.env.CUSTOM_DOMAINS_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || !url.pathname.startsWith("/opentenant_it_")) throw new Error("Custom domain proofs require a loopback opentenant_it_ database");
}
describe.skipIf(!connectionString)("custom domains with real PostgreSQL", () => {
  const pool = new Pool({ connectionString });
  const actor = { kind: "user" as const, userId: "user_example" };
  let token: string;
  beforeAll(async () => {
    const directory = new URL("../../../tooling/migrations/sql/control-plane/", import.meta.url);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    await applyMigrations(pool, await Promise.all(files.map(async (file) => ({ id: file.replace(/\.sql$/, ""), sql: await readFile(new URL(file, directory), "utf8") }))));
    await pool.query("insert into tenants (tenant_id, slug, display_name, status, data_region) values ('ten_domain_alpha', 'domain-alpha', 'Example Alpha', 'active', 'us'), ('ten_domain_beta', 'domain-beta', 'Example Beta', 'active', 'us')");
  });
  afterAll(() => pool.end());
  it("adds pending with a hash, audits, and refuses to resolve before proof", async () => {
    const result = await addCustomDomain("ten_domain_alpha", "app.customer.test", actor, pool);
    token = result.token;
    const { rows } = await pool.query("select * from domains where host = 'app.customer.test'");
    expect(rows[0].challenge_hash).toHaveLength(64);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0].active).toBe(false);
    expect(await verifiedCustomTenantForHost("app.customer.test", pool)).toBeNull();
    expect((await pool.query("select action from audit_events where tenant_id = 'ten_domain_alpha'")).rows).toEqual([{ action: "domain.added" }]);
  });
  it("prevents a different tenant claiming or removing the domain", async () => {
    await expect(addCustomDomain("ten_domain_beta", "app.customer.test", actor, pool)).rejects.toThrow("Domain unavailable");
    await expect(removeCustomDomain("ten_domain_beta", "app.customer.test", actor, pool)).rejects.toThrow();
    await expect(addCustomDomain("ten_domain_beta", "child.app.customer.test", actor, pool)).rejects.toThrow();
  });
  it("verifies through stub DNS, resolves only its tenant, and rechecks after expiry", async () => {
    expect((await verifyCustomDomain("ten_domain_alpha", "app.customer.test", actor, async () => [[token]], pool)).active).toBe(true);
    expect(await verifiedCustomTenantForHost("app.customer.test", pool)).toMatchObject({ tenantId: "ten_domain_alpha" });
    await pool.query("update domains set verification_valid_until = now() - interval '1 second' where host = 'app.customer.test'");
    expect(await verifiedCustomTenantForHost("app.customer.test", pool)).toBeNull();
    expect((await verifyCustomDomain("ten_domain_alpha", "app.customer.test", actor, async () => [[token]], pool)).active).toBe(true);
  });
  it("deactivates immediately on failed periodic verification", async () => {
    await verifyCustomDomain("ten_domain_alpha", "app.customer.test", actor, async () => [], pool);
    expect(await verifiedCustomTenantForHost("app.customer.test", pool)).toBeNull();
  });
  it("rolls back registration when the audit write fails", async () => {
    await pool.query(`create function reject_domain_audit() returns trigger language plpgsql as $$ begin if new.action = 'domain.added' then raise exception 'synthetic audit failure'; end if; return new; end $$`);
    await pool.query("create trigger reject_domain_audit before insert on audit_events for each row execute function reject_domain_audit()");
    try {
      await expect(addCustomDomain("ten_domain_alpha", "audit.customer.test", actor, pool)).rejects.toThrow();
      expect((await pool.query("select 1 from domains where host = 'audit.customer.test'")).rows).toHaveLength(0);
    } finally { await pool.query("drop trigger reject_domain_audit on audit_events; drop function reject_domain_audit()"); }
  });
  it("rotates expired or lost challenges and rejects old TXT evidence", async () => {
    await pool.query("update domains set challenge_expires_at=now()-interval '1 hour' where host='app.customer.test'");
    const previous = token;
    const next = await reissueCustomDomain("ten_domain_alpha", "app.customer.test", actor, pool);
    token = next.token;
    expect(token).not.toBe(previous);
    const row = (await pool.query("select * from domains where host='app.customer.test'")).rows[0];
    expect(row.challenge_record).toBe("_opentenant-challenge.app.customer.test");
    expect(row.active).toBe(false); expect(row.verified_at).toBeNull(); expect(row.verification_valid_until).toBeNull(); expect(row.next_check_at).toBeNull();
    expect(JSON.stringify(row)).not.toContain(token);
    expect((await verifyCustomDomain("ten_domain_alpha", "app.customer.test", actor, async () => [[previous]], pool)).active).toBe(false);
    expect((await verifyCustomDomain("ten_domain_alpha", "app.customer.test", actor, async () => [[token]], pool)).active).toBe(true);
    await expect(reissueCustomDomain("ten_domain_beta", "app.customer.test", actor, pool)).rejects.toThrow("Domain unavailable");
  });
  it("discards DNS responses after a concurrent reissue even when they contain the new token", async () => {
    await expect(verifyCustomDomain("ten_domain_alpha", "app.customer.test", actor, async () => {
      token = (await reissueCustomDomain("ten_domain_alpha", "app.customer.test", actor, pool)).token;
      return [[token]];
    }, pool)).rejects.toThrow("Challenge changed");
    expect((await pool.query("select active, verification from domains where host='app.customer.test'")).rows).toEqual([{ active: false, verification: "pending" }]);
  });
  it("keeps private branding names, reads and selectable references within their tenant", async () => {
    const content = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
    for (const [id, tenant, name] of [["asset_alpha", "ten_domain_alpha", "Alpha private"], ["asset_beta", "ten_domain_beta", "Beta private"]]) {
      await pool.query("insert into tenant_branding_assets(asset_id,tenant_id,display_name,mime_type,content) values ($1,$2,$3,'image/png',$4)", [id, tenant, name, content]);
    }
    expect((await tenantBrandingAssets("ten_domain_alpha", pool)).map(asset => asset.displayName)).not.toContain("Beta private");
    expect(await tenantOwnsBrandingAsset("ten_domain_alpha", "/api/settings/branding/assets/asset_beta", pool)).toBe(false);
    expect(await readTenantBrandingAsset("ten_domain_alpha", "asset_beta", pool)).toBeNull();
    expect(await readTenantBrandingAsset("ten_domain_alpha", "asset_alpha", pool)).toEqual({ mime_type: "image/png", content });
  });
  describe("scheduled domain rechecks with simulated time and DNS", () => {
    const start = new Date("2030-01-01T00:00:00Z");
    const due = new Date("2030-01-02T00:00:00Z");
    const expiry = new Date("2030-01-03T00:00:00Z");
    const host = "scheduled.customer.test";
    const domain = { host, tenant_id: "ten_domain_alpha" };
    const dns = new Map<string, string[][]>();
    const resolver = vi.fn(async (record: string) => dns.get(record) ?? []);
    async function seed(name = host, tenant = domain.tenant_id) {
      const challenge = await addCustomDomain(tenant, name, actor, pool);
      await verifyCustomDomain(tenant, name, actor, async () => [[challenge.token]], pool);
      await pool.query(`update domains set verified_at=$2, next_check_at=$3, verification_valid_until=$4,
        challenge_expires_at=$3 where host=$1`, [name, start, due, expiry]);
      dns.set(challenge.record, [[challenge.token]]);
      return challenge;
    }
    const run = (time: Date, resolveTxt: TxtResolver = resolver) => runCustomDomainRechecks({ pool, now: () => time, resolveTxt, stagger: async () => {} });
    const stored = async () => (await pool.query("select * from domains where host=$1", [host])).rows[0];
    afterEach(async () => {
      await pool.query("delete from domains where host=$1 or host like 'batch%.scheduler.test'", [host]);
      dns.clear(); resolver.mockClear();
    });
    it("runs only when due, before expiry, and extends validity using the persisted record", async () => {
      const challenge = await seed();
      expect(await run(new Date(due.getTime() - 1))).toEqual({ selected: 0, checked: 0 });
      expect(resolver).not.toHaveBeenCalled();
      expect(await run(due)).toEqual({ selected: 1, checked: 1 });
      expect(resolver).toHaveBeenCalledExactlyOnceWith(challenge.record);
      const row = await stored();
      expect(row.verification_valid_until).toEqual(new Date("2030-01-04"));
      expect(row.next_check_at.getTime()).toBeLessThan(row.verification_valid_until.getTime());
      expect(await run(due)).toEqual({ selected: 0, checked: 0 });
      expect((await pool.query("select detail from audit_events where subject=$1 and action='domain.reverification_checked'", [host])).rows.at(-1)?.detail).toEqual({ verification: "verified", active: true, reason: null });
      expect((await new PgAuditStore(pool).verifyChain(domain.tenant_id)).intact).toBe(true);
    });
    it("retries within grace, deactivates on loss at expiry, and can recover", async () => {
      const challenge = await seed(); dns.delete(challenge.record);
      expect((await run(due)).checked).toBe(1);
      expect(await stored()).toMatchObject({ active: true, recheck_reason: "dns_unverified", verification_valid_until: expiry });
      expect((await run(expiry)).checked).toBe(1);
      expect(await stored()).toMatchObject({ active: false, verification: "failed", recheck_reason: "dns_unverified", verification_valid_until: expiry });
      const retry = (await stored()).next_check_at;
      dns.set(challenge.record, [[challenge.token]]);
      expect((await run(retry)).checked).toBe(1);
      expect(await stored()).toMatchObject({ active: true, recheck_reason: null });
      expect((await pool.query("select detail->>'active' as active from audit_events where subject=$1 and action='domain.reverification_checked' order by sequence desc limit 3", [host])).rows).toEqual([{ active: "true" }, { active: "false" }, { active: "true" }]);
    });
    it("normalizes resolver errors without exposing their content in state or audit", async () => {
      await seed();
      const resolveTxt = vi.fn(async () => { throw new Error("sensitive synthetic provider diagnostic"); });
      await run(expiry, resolveTxt);
      expect(await stored()).toMatchObject({ active: false, recheck_reason: "dns_unavailable" });
      expect(JSON.stringify((await pool.query("select detail from audit_events where subject=$1", [host])).rows)).not.toContain("sensitive synthetic");
    });
    it("two workers perform and audit one recheck for the same domain", async () => {
      await seed();
      const countBefore = (await pool.query("select count(*)::int as count from audit_events where subject=$1 and action='domain.reverification_checked'", [host])).rows[0].count;
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      const resolveTxt = vi.fn(async (record: string) => { entered(); await gate; return dns.get(record) ?? []; });
      const first = run(due, resolveTxt);
      try {
        await started;
        expect(await run(due, resolveTxt)).toEqual({ selected: 1, checked: 0 });
      } finally { release(); await first; }
      expect(resolveTxt).toHaveBeenCalledOnce();
      expect((await run(due, resolveTxt)).checked).toBe(0);
      expect((await pool.query("select count(*)::int as count from audit_events where subject=$1 and action='domain.reverification_checked'", [host])).rows[0].count).toBe(countBefore + 1);
    });
    it("skips a row mid-reissue and ignores stale selections after actual challenge rotation", async () => {
      const previous = await seed();
      const lock = await pool.connect();
      try {
        await lock.query("begin");
        await lock.query("select host from domains where host=$1 for update", [host]);
        expect(await run(due)).toEqual({ selected: 1, checked: 0 });
        expect(resolver).not.toHaveBeenCalled();
      } finally { await lock.query("rollback"); lock.release(); }
      const selected = await selectDueCustomDomains(pool, due);
      const replacement = await reissueCustomDomain(domain.tenant_id, host, actor, pool);
      expect(await recheckCustomDomain(selected[0], { pool, resolveTxt: resolver, now: () => due })).toBe(false);
      expect(resolver).not.toHaveBeenCalled();
      expect(await stored()).toMatchObject({ active: false, verification: "pending", recheck_reason: null });
      expect((await verifyCustomDomain(domain.tenant_id, host, actor, async () => [[previous.token]], pool)).active).toBe(false);
      expect((await run(due)).checked).toBe(0);
      expect((await verifyCustomDomain(domain.tenant_id, host, actor, async () => [[replacement.token]], pool)).active).toBe(true);
      await pool.query("update domains set next_check_at=$2, verification_valid_until=$3 where host=$1", [host, due, expiry]);
      dns.set(replacement.record, [[previous.token]]);
      expect((await run(expiry)).checked).toBe(1);
      expect(await stored()).toMatchObject({ active: false, recheck_reason: "dns_unverified" });
      dns.set(replacement.record, [[replacement.token]]);
      expect((await run((await stored()).next_check_at)).checked).toBe(1);
      expect(await stored()).toMatchObject({ active: true, recheck_reason: null });
    });
    it("rolls back the domain result when its audit fails and retries after rollback", async () => {
      await seed();
      await pool.query(`create function reject_recheck_audit() returns trigger language plpgsql as $$ begin if new.action = 'domain.reverification_checked' then raise exception 'synthetic audit failure'; end if; return new; end $$`);
      await pool.query("create trigger reject_recheck_audit before insert on audit_events for each row execute function reject_recheck_audit()");
      try {
        await expect(run(expiry)).rejects.toThrow("synthetic audit failure");
        expect(await stored()).toMatchObject({ next_check_at: due, verification_valid_until: expiry });
      } finally { await pool.query("drop trigger reject_recheck_audit on audit_events; drop function reject_recheck_audit()"); }
      expect((await run(expiry)).checked).toBe(1);
    });
    it("caps the batch at 25 and binds rechecks to the selected tenant", async () => {
      for (let index = 0; index < 26; index++) await seed(`batch${index}.scheduler.test`);
      const selected = await selectDueCustomDomains(pool, due, 1000);
      expect(selected).toHaveLength(25);
      expect(await recheckCustomDomain({ ...selected[0], tenant_id: "ten_domain_beta" }, { pool, resolveTxt: resolver, now: () => due })).toBe(false);
      expect(resolver).not.toHaveBeenCalled();
      expect((await run(due)).checked).toBe(25);
      expect((await run(due)).checked).toBe(1);
    });
  });
  it("removes and audits without leaving a routable cache entry", async () => {
    await verifyCustomDomain("ten_domain_alpha", "app.customer.test", actor, async () => [[token]], pool);
    await removeCustomDomain("ten_domain_alpha", "app.customer.test", actor, pool);
    expect(await verifiedCustomTenantForHost("app.customer.test", pool)).toBeNull();
    expect((await pool.query("select action from audit_events where tenant_id = 'ten_domain_alpha' order by sequence desc limit 1")).rows[0].action).toBe("domain.removed");
  });
});
