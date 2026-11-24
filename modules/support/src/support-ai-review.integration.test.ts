import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { createTicket, addMessage, type SupportClient } from "./ticket-store";
import { PgSupportAiReviewStore, SupportAiConflict, SupportAiNotFound } from "./support-ai-review-store";
import { SupportAiReviewService } from "./support-ai-review-service";
import { syntheticSupportAi } from "./support-ai-review-synthetic";
import type { AiActor, AiTransaction } from "./support-ai-review-types";
const require = createRequire(new URL("../../../packages/database/package.json",import.meta.url));
interface Client extends SupportClient { release(): void }
interface Pool extends SupportClient { connect(): Promise<Client>; end(): Promise<void> }
const { Pool } = require("pg") as { Pool:new (options:object) => Pool };
const available = process.env.SUPPORT_AI_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL;
const actor: AiActor = { tenantId:"ten_ai_a",actorId:"staff_a",kind:"tenant_admin" };
const other: AiActor = { ...actor,tenantId:"ten_ai_b" };
const auditActor = { kind:"user",userId:actor.actorId } as const;
let sequence = 0;
describe.skipIf(!available)("durable Support AI PostgreSQL", () => {
  let pool:Pool; let tx:AiTransaction; let store:PgSupportAiReviewStore;
  beforeAll(async () => {
    const target = new URL(available!);
    if (!["localhost","127.0.0.1"].includes(target.hostname) || (process.env.SUPPORT_AI_DATABASE_URL ? !target.pathname.startsWith("/opentenant_it_") : target.pathname !== "/postgres") || !target.port || target.port === "5432") throw Error("disposable database required");
    if (!process.env.SUPPORT_AI_DATABASE_URL) {
      const admin = new Pool({ connectionString:available });
      try { if (!(await admin.query("select 1 from pg_database where datname='opentenant_it_support_ai'")).rows.length) await admin.query("create database opentenant_it_support_ai"); }
      finally { await admin.end(); }
      target.pathname = "/opentenant_it_support_ai";
    }
    pool = new Pool({ connectionString:target.href,max:8 });
    await pool.query("drop schema if exists support cascade; drop schema if exists tenant_core cascade");
    await pool.query("do $$ begin if not exists(select 1 from pg_roles where rolname='tenant_app') then create role tenant_app nologin; end if; end $$");
    for (const scope of ["tenant-core","tenant-support"]) {
      const directory = new URL(`../../../tooling/migrations/sql/${scope}/`,import.meta.url);
      for (const file of (await readdir(directory)).filter(f=>f.endsWith(".sql")).sort()) await pool.query(await readFile(new URL(file,directory),"utf8"));
    }
    await pool.query("insert into tenant_core.tenant_meta(tenant_id,data_region) values ('ten_ai_a','us')");
    await pool.query("insert into support.ai_controls(tenant_id,enabled,synthetic,actor_hourly_limit) values ('ten_ai_a',true,true,100)");
    tx = async (tenant,work) => {
      const c=await pool.connect();
      try { await c.query("begin"); await c.query("set local role tenant_app"); await c.query("select set_config('app.tenant_id',$1,true)",[tenant]); const value=await work(c); await c.query("commit"); return value; }
      catch(error) { await c.query("rollback"); throw error; } finally { c.release(); }
    };
    store = new PgSupportAiReviewStore(tx);
    await tx(actor.tenantId,c=>c.query("insert into support.knowledge_articles(tenant_id,title,content,category,status,created_by) values ($1,'Account guide','You can reset your password in Settings. Keep your recovery codes safe.','how_to','published','editor')",[actor.tenantId]));
  },60000);
  afterAll(async()=>{ await pool?.end(); });
  async function ticket() { return tx(actor.tenantId,c=>createTicket(c,{ tenantId:actor.tenantId,actor:auditActor,createdBy:"requester_private",subject:"Password reset",description:"How do I reset a password?",category:"account_issue" })); }
  async function request(deps=syntheticSupportAi()) { const t=await ticket(); const input={ ticketId:t.id,expectedTicketVersion:1,idempotencyKey:`key-${++sequence}` }; return { t,input,view:await new SupportAiReviewService(store,deps).request(actor,input) }; }
  it("persists a reviewed suggestion after a store restart with no ticket, outbox or message mutation", async()=>{
    const {t,input,view}=await request();
    expect(view.terminal?.kind).toBe("review_required"); expect(view.suggestion?.artifact.reply).toBe("You can reset your password in Settings.");
    expect((await new PgSupportAiReviewStore(tx).read(actor,t.id)).suggestion).toEqual(view.suggestion);
    expect((await pool.query("select version::int,category from support.tickets where id=$1",[t.id])).rows[0]).toEqual({version:1,category:"account_issue"});
    expect((await pool.query("select * from support.messages where ticket_id=$1",[t.id])).rows).toHaveLength(0);
    expect((await pool.query("select * from support.outbox_events where ticket_id=$1",[t.id])).rows).toHaveLength(1);
    await store.review(actor,view.suggestion!.id,1,"reviewed");
    await expect(store.review(actor,view.suggestion!.id,1,"dismissed")).rejects.toBeInstanceOf(SupportAiConflict);
    expect((await store.read(actor,t.id)).suggestion?.review).toBe("reviewed");
    await tx(actor.tenantId,c=>addMessage(c,{tenantId:actor.tenantId,ticketId:t.id,actor:auditActor,authorId:actor.actorId,body:"Human edited reply.",internal:false}));
    expect((await store.read(actor,t.id)).visibility).toBe("stale");
    expect((await new SupportAiReviewService(store,syntheticSupportAi()).request(actor,input)).request?.id).toBe(view.request?.id);
    await expect(new SupportAiReviewService(store,syntheticSupportAi()).request(actor,{...input,idempotencyKey:"new-stale-key"})).rejects.toBeInstanceOf(SupportAiConflict);
  });
  it("deduplicates concurrent admission and rejects reuse for different input",async()=>{
    const t=await ticket(); const input={ticketId:t.id,expectedTicketVersion:1,idempotencyKey:`key-${++sequence}`};
    const service=new SupportAiReviewService(store,syntheticSupportAi());
    await Promise.all([service.request(actor,input),service.request(actor,input)]);
    expect((await pool.query("select * from support.ai_suggestion_requests where ticket_id=$1",[t.id])).rows).toHaveLength(1);
    expect((await pool.query("select * from support.ai_suggestion_attempts a join support.ai_suggestion_requests r on r.id=a.request_id where r.ticket_id=$1",[t.id])).rows).toHaveLength(1);
    const next=await ticket(); await expect(service.request(actor,{...input,ticketId:next.id})).rejects.toBeInstanceOf(SupportAiConflict);
  });
  it("returns the same absence for another tenant and missing suggestion",async()=>{
    const {t,view}=await request();
    await expect(store.read(other,t.id)).rejects.toBeInstanceOf(SupportAiNotFound);
    await expect(store.review(other,view.suggestion!.id,1,"reviewed")).rejects.toBeInstanceOf(SupportAiNotFound);
    await expect(store.review(other,"00000000-0000-4000-8000-000000000000",1,"reviewed")).rejects.toBeInstanceOf(SupportAiNotFound);
  });
  it("abstains and records safe provider failures without raw messages",async()=>{
    expect((await request(syntheticSupportAi({suggest:async()=>({kind:"abstain",reason:"insufficient_information"})}))).view.terminal).toMatchObject({kind:"abstained",reason:"insufficient_information"});
    const failed=await request(syntheticSupportAi({suggest:async()=>{throw Error("PRIVATE_PROVIDER_ERROR");}}));
    expect(failed.view.suggestion).toBeNull();
    expect(JSON.stringify(failed.view)).not.toContain("PRIVATE_PROVIDER_ERROR");
  });
  it("rejects malformed, unsupported and banned output as a whole",async()=>{
    const deps=syntheticSupportAi({suggest:async()=>({kind:"draft",category:"billing",priority:"low",reply:"Invented promise.",confidence:1,claims:[]})});
    const quarantined:unknown[]=[]; deps.quarantine=async(_r,output)=>{quarantined.push(output);};
    const result=await request(deps); expect(result.view.terminal).toMatchObject({kind:"unavailable",reason:"invalid_output"}); expect(result.view.suggestion).toBeNull(); expect(quarantined).toHaveLength(1);
    const banned=syntheticSupportAi(); banned.loadVoice=async()=>({version:2,digest:"a".repeat(64),bannedWords:["password"]}); banned.quarantine=async()=>{};
    expect((await request(banned)).view.terminal).toMatchObject({kind:"unavailable",reason:"invalid_output"});
  });
  it("fails closed on missing/mismatched inference evidence",async()=>{
    for(const mismatch of ["verify","tenant","parent","credential"]){
      const deps=syntheticSupportAi(); const open=deps.inference.open;
      if(mismatch==="verify") deps.inference.verify=async()=>false;
      else deps.inference.open=async(...args)=>{ const result=await open(...args); if(mismatch==="tenant") result.attempt.tenantId=other.tenantId; if(mismatch==="parent") result.attempt.preparationId="00000000-0000-4000-8000-000000000000"; if(mismatch==="credential") result.attempt.credentialOrigin="none" as never; return result; };
      const {view}=await request(deps); expect(view.terminal?.kind).toBe("audit_failure"); expect(view.suggestion).toBeNull();
    }
  });
  it("cancels without a suggestion and permits no late terminal replacement",async()=>{
    const controller=new AbortController(); let started!:()=>void;
    const waiting=new Promise<void>(resolve=>{started=resolve;});
    const deps=syntheticSupportAi({suggest:async()=>{started(); return new Promise(()=>{});}});
    const t=await ticket(); const result=new SupportAiReviewService(store,deps).request(actor,{ticketId:t.id,expectedTicketVersion:1,idempotencyKey:`key-${++sequence}`},controller.signal);
    await waiting; controller.abort(); const view=await result;
    expect(view.terminal?.kind).toBe("cancelled"); expect(view.suggestion).toBeNull();
    await store.complete(view.request!,{kind:"unavailable",reason:"invalid_output"});
    expect((await store.read(actor,t.id)).terminal?.kind).toBe("cancelled");
  });
  it("hides revoked knowledge immediately, including after republishing changed content",async()=>{
    const {t,view}=await request(); const source=view.request!.sources[0]!;
    await tx(actor.tenantId,c=>c.query("update support.knowledge_articles set status='archived' where id=$1",[source.articleId]));
    expect((await store.read(actor,t.id)).suggestion).toBeNull();
    await expect(store.review(actor,view.suggestion!.id,1,"reviewed")).rejects.toBeInstanceOf(SupportAiConflict);
    await tx(actor.tenantId,c=>c.query("update support.knowledge_articles set status='published',content='Changed knowledge.' where id=$1",[source.articleId]));
    expect((await store.read(actor,t.id)).visibility).toBe("revoked");
    await tx(actor.tenantId,c=>c.query("update support.knowledge_articles set content='You can reset your password in Settings. Keep your recovery codes safe.' where id=$1",[source.articleId]));
  });
  it("serializes durable daily budgets and hides a disabled/re-enabled epoch",async()=>{
    const {t}=await request();
    await pool.query("update support.ai_controls set enabled=false where tenant_id=$1",[actor.tenantId]);
    expect((await store.read(actor,t.id)).suggestion).toBeNull();
    expect((await request()).view.terminal).toMatchObject({kind:"unavailable",reason:"disabled"});
    await pool.query("update support.ai_controls set enabled=true,daily_limit=0 where tenant_id=$1",[actor.tenantId]);
    expect((await store.read(actor,t.id)).suggestion).toBeNull();
    expect((await request()).view.terminal).toMatchObject({kind:"unavailable",reason:"budget_exhausted"});
    await pool.query("update support.ai_controls set daily_limit=100,actor_hourly_limit=100 where tenant_id=$1",[actor.tenantId]);
  });
  it("presents interrupted requests without replay and rejects late completion",async()=>{
    const t=await ticket();
    const r=await tx(actor.tenantId,async c=>{
      const r=(await c.query<import("./support-ai-review-types").AiRequest>(`insert into support.ai_suggestion_requests(tenant_id,ticket_id,ticket_version,actor_id,idempotency_key,input_digest,input_watermark,sources,control_epoch,admitted,created_at,execution_deadline,retention_until)
        select $1,$2,1,'staff','interrupted',$3,'watermark','[]',epoch,true,statement_timestamp()-interval '2 minutes',statement_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day' from support.ai_controls where tenant_id=$1 returning *`,[actor.tenantId,t.id,"a".repeat(64)])).rows[0]!;
      await c.query("insert into support.ai_suggestion_audit_events(tenant_id,request_id,actor_id,action) values($1,$2,'staff','requested')",[actor.tenantId,r.id]); return r;
    });
    expect((await store.read(actor,t.id)).terminal).toEqual({kind:"interrupted",reason:"execution_deadline"});
    await store.complete(r,{kind:"unavailable",reason:"invalid_output"});
    expect((await store.read(actor,t.id)).terminal).toEqual({kind:"interrupted",reason:"execution_deadline"});
    expect((await pool.query("select * from support.ai_suggestion_terminals where request_id=$1",[r.id])).rows).toHaveLength(0);
  });
  it("purges content with the ticket while preserving immutable decision digests",async()=>{
    const t=(await pool.query<{id:string}>("insert into support.tickets(tenant_id,ticket_number,created_by,subject,description) values($1,'SUP-PURGE','requester','Password reset','Reset password') returning id",[actor.tenantId])).rows[0]!;
    const view=await new SupportAiReviewService(store,syntheticSupportAi()).request(actor,{ticketId:t.id,expectedTicketVersion:1,idempotencyKey:`key-${++sequence}`});
    expect(view.suggestion).not.toBeNull();
    expect((await pool.query("select support.purge_ai_suggestion_content() as removed")).rows[0]).toEqual({removed:"0"});
    await expect(pool.query("delete from support.ai_suggestions where request_id=$1",[view.request!.id])).rejects.toMatchObject({code:"42501"});
    // Privileged lifecycle erasure is represented by removal of its canonical
    // ticket. Product code has no ticket-delete port.
    await pool.query("delete from support.tickets where id=$1",[t.id]);
    expect((await pool.query("select support.purge_ai_suggestion_content() as removed")).rows[0]).toMatchObject({removed:"1"});
    expect((await pool.query("select * from support.ai_suggestions where request_id=$1",[view.request!.id])).rows).toHaveLength(0);
    expect((await pool.query("select artifact_digest from support.ai_suggestion_terminals where request_id=$1",[view.request!.id])).rows[0]).toEqual({artifact_digest:view.suggestion!.digest});
    await expect(tx(actor.tenantId,c=>c.query("select support.purge_ai_suggestion_content()"))).rejects.toMatchObject({code:"42501"});
  });
  it("serializes concurrent budget admission and enforces actor rate caps",async()=>{
    const used=Number((await pool.query("select count(*) as n from support.ai_suggestion_requests where tenant_id=$1 and admitted",[actor.tenantId])).rows[0]!.n);
    await pool.query("update support.ai_controls set daily_limit=$2,actor_hourly_limit=100 where tenant_id=$1",[actor.tenantId,used+1]);
    const results=await Promise.all([request(),request()]);
    expect(results.map(result=>result.view.terminal?.kind).sort()).toEqual(["review_required","unavailable"]);
    expect(results.find(result=>result.view.terminal?.kind==="unavailable")!.view.terminal).toMatchObject({reason:"budget_exhausted"});
    await pool.query("update support.ai_controls set daily_limit=100,actor_hourly_limit=0 where tenant_id=$1",[actor.tenantId]);
    expect((await request()).view.terminal).toMatchObject({kind:"unavailable",reason:"rate_limited"});
    await pool.query("update support.ai_controls set actor_hourly_limit=100 where tenant_id=$1",[actor.tenantId]);
  });
  it("assembles only the allowed canonical ticket fields, excluding notes and requester identity",async()=>{
    const t=await ticket();
    await tx(actor.tenantId,c=>addMessage(c,{tenantId:actor.tenantId,ticketId:t.id,actor:auditActor,authorId:"private_author",body:"PRIVATE_INTERNAL_NOTE",internal:true}));
    await tx(actor.tenantId,c=>addMessage(c,{tenantId:actor.tenantId,ticketId:t.id,actor:auditActor,authorId:"private_author",body:"PUBLIC_REPLY",internal:false}));
    const seen:unknown[]=[];
    const deps=syntheticSupportAi({suggest:async input=>{seen.push(input);return {kind:"abstain",reason:"insufficient_information"};}});
    await new SupportAiReviewService(store,deps).request(actor,{ticketId:t.id,expectedTicketVersion:3,idempotencyKey:`key-${++sequence}`});
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).toContain("PUBLIC_REPLY");
    for(const forbidden of ["PRIVATE_INTERNAL_NOTE","private_author","requester_private","preferredWords","exampleRewrites","credential"]) expect(JSON.stringify(seen)).not.toContain(forbidden);
  });
  it("keeps a prior valid artifact as historical after a failed later request",async()=>{
    const {t,view}=await request();
    const deps=syntheticSupportAi({suggest:async()=>{throw Error("private error");}});
    const failed=await new SupportAiReviewService(store,deps).request(actor,{ticketId:t.id,expectedTicketVersion:1,idempotencyKey:`key-${++sequence}`});
    expect(failed.terminal).toMatchObject({kind:"provider_failure",reason:"adapter_error"});
    expect(failed.suggestion).toBeNull(); expect(failed.history?.[0]?.artifact).toEqual(view.suggestion?.artifact);
  });
  it("rolls back suggestions and reviews atomically when support audit recording fails",async()=>{
    const failingTx:AiTransaction=(tenant,work)=>tx(tenant,c=>work({query:async(sql,params)=>{
      if(sql.includes("insert into support.ai_suggestion_audit_events") && params?.[3]==="suggestion_created") throw Error("PRIVATE_DATABASE_FAILURE");
      return c.query(sql,params);
    }}));
    const t=await ticket(); const failingStore=new PgSupportAiReviewStore(failingTx);
    const view=await new SupportAiReviewService(failingStore,syntheticSupportAi()).request(actor,{ticketId:t.id,expectedTicketVersion:1,idempotencyKey:`key-${++sequence}`});
    expect(view.terminal).toMatchObject({kind:"audit_failure",reason:"support_evidence"}); expect(view.suggestion).toBeNull();
    expect((await pool.query("select * from support.ai_suggestions where request_id=$1",[view.request!.id])).rows).toHaveLength(0);
    expect(JSON.stringify(view)).not.toContain("PRIVATE_DATABASE_FAILURE");
    const valid=await request();
    const reviewTx:AiTransaction=(tenant,work)=>tx(tenant,c=>work({query:async(sql,params)=>{
      if(sql.includes("insert into support.ai_suggestion_audit_events") && params?.[3]==="reviewed") throw Error("review audit failed");
      return c.query(sql,params);
    }}));
    await expect(new PgSupportAiReviewStore(reviewTx).review(actor,valid.view.suggestion!.id,1,"reviewed")).rejects.toThrow("review audit failed");
    expect((await store.read(actor,valid.t.id)).suggestion?.review).toBe("review_required");
  });
  it("rolls back request creation when its requested audit is absent",async()=>{
    const t=await ticket();
    await expect(tx(actor.tenantId,c=>c.query(`insert into support.ai_suggestion_requests(tenant_id,ticket_id,ticket_version,actor_id,idempotency_key,input_digest,input_watermark,sources,control_epoch,admitted,retention_until) values($1,$2,1,'staff','missing-audit',$3,'watermark','[]',1,true,clock_timestamp()+interval '1 day')`,[actor.tenantId,t.id,"a".repeat(64)]))).rejects.toThrow("audit evidence required");
  });
  it("FORCE RLS, append-only grants, tenant-bound links and TRUNCATE protect every new table",async()=>{
    const {view}=await request();
    for(const table of ["ai_controls","ai_suggestion_requests","ai_suggestion_policy_snapshots","ai_suggestion_attempts","ai_suggestions","ai_suggestion_terminals","ai_suggestion_reviews","ai_suggestion_audit_events"]){
      expect((await pool.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[`support.${table}`])).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
      expect((await tx(other.tenantId,c=>c.query(`select * from support.${table} where tenant_id=$1`,[actor.tenantId]))).rows).toEqual([]);
      await expect(tx(actor.tenantId,c=>c.query(`update support.${table} set tenant_id=tenant_id`))).rejects.toMatchObject({code:"42501"});
      await expect(tx(actor.tenantId,c=>c.query(`delete from support.${table}`))).rejects.toMatchObject({code:"42501"});
      await expect(tx(actor.tenantId,c=>c.query(`truncate support.${table}`))).rejects.toMatchObject({code:"42501"});
    }
    await expect(tx(other.tenantId,c=>c.query("insert into support.ai_suggestion_reviews(tenant_id,request_id,suggestion_id,actor_id,decision,ticket_version) values($1,$2,$3,'other','reviewed',1)",[actor.tenantId,view.request!.id,view.suggestion!.id]))).rejects.toMatchObject({code:"42501"});
    await expect(tx(actor.tenantId,c=>c.query("update support.ai_suggestion_requests set id=id"))).rejects.toMatchObject({code:"42501"});
    await expect(tx(actor.tenantId,c=>c.query("update support.ai_controls set epoch=epoch"))).rejects.toMatchObject({code:"42501"});
    const c=await pool.connect(); try{ await c.query("begin"); await c.query("set local role tenant_app"); expect((await c.query("select * from support.ai_suggestions")).rows).toHaveLength(0); await c.query("rollback"); } finally{c.release();}
  });
});
