import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { addMessage, createTicket, type SupportClient } from "./ticket-store";
import { PgSupportDeliveryStore, retryTicketEmail, type QueuedSupportEmail, type SupportDeliveryTransaction } from "./delivery-store";

// Use the database package's existing PostgreSQL driver, not a second dependency.
const require = createRequire(new URL("../../../packages/database/package.json", import.meta.url));
interface Client extends SupportClient { release(): void }
interface Pool extends SupportClient { connect(): Promise<Client>; end(): Promise<void> }
const { Pool } = require("pg") as { Pool: new (options: object) => Pool };
const url = process.env.TENANT_SUPPORT_INTEGRATION_DATABASE_URL;
const actor = { kind: "user", userId: "user_a" } as const;
const tenant = "ten_email_a";
const other = "ten_email_b";

describe.skipIf(!url)("durable support email against PostgreSQL", () => {
  let pool: Pool;
  let store: PgSupportDeliveryStore;
  let transaction: SupportDeliveryTransaction;
  let ticketId: string;
  let claim: QueuedSupportEmail;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.startsWith("/opentenant_it_")) throw Error("Disposable integration database required");
    pool = new Pool({ connectionString: url, max: 5 });
    await pool.query("drop schema if exists support cascade; drop schema if exists tenant_core cascade");
    await pool.query("do $$ begin if not exists(select 1 from pg_roles where rolname='tenant_app') then create role tenant_app nologin; end if; end $$");
    for (const catalog of ["tenant-core", "tenant-support"]) {
      const directory = new URL(`../../../tooling/migrations/sql/${catalog}/`, import.meta.url);
      for (const file of (await readdir(directory)).filter(f => f.endsWith(".sql")).sort()) await pool.query(await readFile(new URL(file, directory), "utf8"));
    }
    await pool.query("insert into tenant_core.tenant_meta(tenant_id,data_region) values ($1,'us')", [tenant]);
    transaction = async (tenantId, work) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local role tenant_app");
        await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        const value = await work(client);
        await client.query("commit");
        return value;
      } catch (error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
    };
    store = new PgSupportDeliveryStore(transaction);
    await transaction(tenant, c => c.query("insert into support.delivery_preferences(tenant_id,subject_id,channel,enabled,destination_ref) values ($1,'user_a','email',true,'directory:user_a')", [tenant]));
  }, 60_000);
  afterAll(async () => { await pool?.end(); });
  const create = () => transaction(tenant, c => createTicket(c, { tenantId: tenant, actor, createdBy: "user_a", subject: "Example email", description: "Synthetic description", category: "other" }));

  it("rolls back ticket, audit, outbox and delivery together", async () => {
    await expect(transaction(tenant, async c => {
      await createTicket(c, { tenantId: tenant, actor, createdBy: "user_a", subject: "Rollback", description: "Synthetic", category: "other" });
      throw Error("rollback proof");
    })).rejects.toThrow("rollback proof");
    for (const table of ["tickets", "ticket_events", "outbox_events", "email_deliveries"]) expect((await pool.query(`select * from support.${table}`)).rows).toHaveLength(0);
    ticketId = (await create()).id;
    expect((await pool.query("select * from support.email_deliveries")).rows).toHaveLength(1);
  });
  it("isolates tenants and claims once under concurrent workers", async () => {
    const claims = await Promise.all(Array.from({ length: 4 }, () => store.claim(tenant)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    claim = claims.find(Boolean)!;
    expect(await store.claim(other)).toBeNull();
    expect((await transaction(other, c => c.query("select * from support.email_deliveries"))).rows).toEqual([]);
    await expect(transaction(other, c => c.query("insert into support.delivery_preferences(tenant_id,subject_id,channel,enabled,destination_ref) values ($1,'user_a','email',true,'directory:user_a')", [tenant]))).rejects.toMatchObject({ code: "42501" });
  });
  it("recovers an expired lease after restart and fences the old owner", async () => {
    expect(await new PgSupportDeliveryStore(transaction).claim(tenant)).toBeNull();
    await pool.query("update support.email_deliveries set lease_until=now()-interval '1 second' where id=$1", [claim.id]);
    const recovered = (await new PgSupportDeliveryStore(transaction).claim(tenant))!;
    expect(recovered.idempotency_key).toBe(claim.idempotency_key);
    expect(recovered.lease_token).not.toBe(claim.lease_token);
    expect(await store.ready(claim)).toBe(false);
    expect(await store.settle(claim, { ok: true })).toBe(false);
    claim = recovered;
  });
  it("persists backoff and safely terminates permanent failures", async () => {
    expect(await store.settle(claim, { ok: false, safeErrorClass: Error("driver secret") })).toBe(true);
    const row = (await pool.query<{ status: string; safe_error: string; waiting: boolean }>("select status,safe_error,next_attempt_at > now() as waiting from support.email_deliveries where id=$1", [claim.id])).rows[0];
    expect(row).toMatchObject({ status: "retry", safe_error: "transient", waiting: true });
    expect(await store.claim(tenant)).toBeNull();
    await pool.query("update support.email_deliveries set next_attempt_at=now() where id=$1", [claim.id]);
    claim = (await store.claim(tenant))!;
    await store.settle(claim, { ok: false, safeErrorClass: "permanent" });
  });
  it("audits one concurrent manual retry without changing message identity", async () => {
    expect(await transaction(other, c => retryTicketEmail(c, { tenantId: other, ticketId, deliveryId: claim.id, actor }))).toBe(false);
    const retries = await Promise.all([1, 2].map(() => transaction(tenant, c => retryTicketEmail(c, { tenantId: tenant, ticketId, deliveryId: claim.id, actor }))));
    expect(retries.sort()).toEqual([false, true]);
    const events = await pool.query<{ actor: unknown }>("select actor from support.email_delivery_events where action='manual_retry'");
    expect(events.rows).toEqual([{ actor }]);
    const retried = (await store.claim(tenant))!;
    expect(retried.idempotency_key).toBe(claim.idempotency_key);
    expect(retried.attempts).toBe(1);
    expect(await store.settle(retried, { ok: true })).toBe(true);
    expect(await store.claim(tenant)).toBeNull();
    await expect(pool.query("update support.email_deliveries set status='pending', delivered_at=null where id=$1", [claim.id])).rejects.toThrow("immutable");
  });
  it("queues public replies, excludes internal notes, and honors disabled preferences", async () => {
    const reply = (internal: boolean) => transaction(tenant, c => addMessage(c, { tenantId: tenant, ticketId, actor, authorId: "user_staff", body: "Synthetic reply", internal }));
    await reply(false);
    await reply(true);
    expect((await pool.query("select * from support.email_deliveries")).rows).toHaveLength(2);
    const queued = (await store.claim(tenant))!;
    expect(await store.ready(queued)).toBe(true);
    await transaction(tenant, c => c.query("update support.delivery_preferences set enabled=false where tenant_id=$1", [tenant]));
    expect(await store.ready(queued)).toBe(false);
    await store.settle(queued, { ok: false, safeErrorClass: "destination_unavailable" });
    await reply(false);
    expect((await pool.query("select * from support.email_deliveries")).rows).toHaveLength(2);
  });
  it("recovers a process that dies on the final attempt into an audited terminal failure", async () => {
    await transaction(tenant, c => c.query("update support.delivery_preferences set enabled=true where tenant_id=$1", [tenant]));
    await create();
    const last = (await store.claim(tenant))!;
    await pool.query("update support.email_deliveries set attempts=5,total_attempts=5,lease_until=now()-interval '1 second' where id=$1", [last.id]);
    expect(await store.claim(tenant)).toBeNull();
    expect((await pool.query("select status,safe_error from support.email_deliveries where id=$1", [last.id])).rows[0]).toEqual({ status: "failed", safe_error: "transient" });
    expect((await pool.query("select * from support.email_delivery_events where delivery_id=$1 and action='failed'", [last.id])).rows).toHaveLength(1);
  });
  it("forces tenant policies on both email tables and denies foreign-context reads and writes", async () => {
    for (const table of ["email_deliveries", "email_delivery_events"]) {
      const shape = await pool.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass", [`support.${table}`]);
      expect(shape.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect((await transaction(other, c => c.query(`select * from support.${table}`))).rows).toEqual([]);
    }
    expect((await transaction(other, c => c.query("update support.email_deliveries set next_attempt_at=now() where tenant_id=$1 returning id", [tenant]))).rows).toEqual([]);
    await expect(transaction(other, c => c.query("insert into support.email_delivery_events(tenant_id,delivery_id,actor,action,attempt) values ($1,$2,'{}','manual_retry',0)", [tenant, claim.id]))).rejects.toMatchObject({ code: "42501" });
    await expect(transaction(other, c => c.query("insert into support.email_deliveries(tenant_id,ticket_id,ticket_number,ticket_version,event,subject_id,destination_ref,idempotency_key) select $1,$2,'SUP-foreign',1,'created','user_a','directory:user_a','foreign-key'", [tenant, ticketId]))).rejects.toMatchObject({ code: "42501" });
  });

});
