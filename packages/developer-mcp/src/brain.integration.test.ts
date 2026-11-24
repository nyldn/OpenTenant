import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantContext, PgModelRoutingStore } from "@opentenant/database";
import { ModelRouter, type TenantId } from "@opentenant/platform-core";
import { migrateTenantCore } from "@opentenant/migrations/tenant-core";
import { migrateTenantModules } from "@opentenant/migrations/tenant-modules";
import { LocalEmbeddingAdapter } from "@opentenant/brain";
import { executeBrainTool, type BrainMcpDependencies } from "@opentenant/brain";
import { proofDatabase, migrateControl } from "./testing/postgres";
const suite = process.env.ADMIN_DATABASE_URL ? describe : describe.skip;
suite("Brain tools against forced RLS and pgvector", { timeout: 30_000 }, () => {
  let db: Awaited<ReturnType<typeof proofDatabase>>;
  const adapter = new LocalEmbeddingAdapter();
  const entity = "00000000-0000-0000-0000-000000000001", chunk = "00000000-0000-0000-0000-000000000002", signal = "00000000-0000-0000-0000-000000000003";
  const principal = { tenantId: "brain_a", userId: "user_a", permissions: ["brain.use", "brain.promote"] };
  const deps = (tenantId = "brain_a"): BrainMcpDependencies => ({
    storage: { withClient: (fn) => withTenantContext(db.pool, tenantId as TenantId, async (client) => { await client.query("set local role tenant_app"); return fn(client); }) },
    resolveEmbeddingRoute: () => new ModelRouter(new PgModelRoutingStore(db.pool)).resolve({ tenantId: tenantId as TenantId, moduleId: "brain", useCase: "embedding", slot: "primary" }), embeddingAdapters: new Map([["local", adapter]]),
  });
  beforeAll(async () => {
    db = await proofDatabase(process.env.ADMIN_DATABASE_URL); await migrateControl(db.pool); await migrateTenantCore(db.pool);
    await db.pool.query("insert into tenant_core.tenant_meta(tenant_id,data_region) values('brain_a','us')");
    await db.pool.query("do $$ begin if not exists(select from pg_roles where rolname='tenant_app') then create role tenant_app nologin nobypassrls; end if; end $$");
    await migrateTenantModules(db.pool);
    await db.pool.query("insert into tenants(tenant_id,slug,display_name,status,data_region) values('brain_a','brain-a','Brain A','active','us'),('brain_b','brain-b','Brain B','active','us')");
    await db.pool.query("insert into model_allowlist_versions(allowlist_version,require_zero_retention,created_by) values('brain-local',false,'owner')");
    await db.pool.query("insert into model_allowlist_entries(allowlist_version,provider,model,region,retention_posture) values('brain-local','local','token-hash-v1','us','zero_retention')");
    await db.pool.query("insert into model_consent_policy_versions(policy_version,published_by) values('brain-policy','owner')");
    for (const tenant of ['brain_a','brain_b']) await db.pool.query("insert into model_routing_slots(tenant_id,module_id,use_case,scope,slot,provider,model,configured_by) values($1,'brain','embedding','tenant_module_use_case','primary','local','token-hash-v1','owner')", [tenant]);
    await db.pool.query("insert into brain.entities(id,tenant_id,kind,canonical_name,summary) values($1,'brain_a','brand','brand.md','# Synthetic brand')", [entity]);
    await db.pool.query("insert into brain.raw_signals(id,tenant_id,source,source_id,visibility,content_hash) values($1,'brain_a','fixture','fixture','internal','synthetic')", [signal]);
    await db.pool.query("insert into brain.raw_signal_payloads(raw_signal_id,tenant_id,content_type,payload_text) values($1,'brain_a','text/plain','tenant architecture')", [signal]);
    const vector = (await adapter.embed([{ id: chunk, content: "tenant architecture" }]))[0]!.vector;
    await db.pool.query("insert into brain.raw_signal_chunks(id,tenant_id,raw_signal_id,chunk_index,token_count,content,embedding,embedding_provider,embedding_model) values($1,'brain_a',$2,0,2,'tenant architecture',$3::vector,'local','token-hash-v1')", [chunk, signal, JSON.stringify(vector)]);
  }, 60_000);
  afterAll(async () => { await db?.close(); }, 60_000);
  it("searches using real pgvector cosine distance and approved embedding provenance", async () => {
    const result = await executeBrainTool(deps(), principal, "search", { query: "tenant architecture" });
    expect(result).toEqual([expect.objectContaining({ id: chunk, content: "tenant architecture", score: expect.any(Number) })]);
  });
  it("denies missing permissions and unavailable hosted adapters before exposing content", async () => {
    await expect(executeBrainTool(deps(), { ...principal, permissions: [] }, "search", { query: "tenant" })).rejects.toThrow("permission");
    await expect(executeBrainTool({ ...deps(), resolveEmbeddingRoute: async () => ({ provider: "hosted", model: "embedding", region: "us" }) }, principal, "search", { query: "tenant" })).rejects.toThrow("adapter unavailable");
  });
  it("does not read foreign rows even if an application tenant predicate is forged", async () => {
    expect(await executeBrainTool(deps("brain_b"), principal, "search", { query: "tenant architecture" })).toEqual([]);
    expect(await executeBrainTool(deps("brain_b"), principal, "get_brand_md", {})).toBeNull();
    await expect(executeBrainTool(deps("brain_b"), principal, "promote_signal", { chunkId: chunk, entityId: entity, rationale: "Foreign" })).rejects.toThrow("unavailable");
  });
  it("promotes a signal and writes a decision atomically, then reads it with citations", async () => {
    const promotion = await executeBrainTool(deps(), principal, "promote_signal", { chunkId: chunk, entityId: entity, rationale: "Reviewed synthetic evidence" });
    expect(promotion).toMatchObject({ id: expect.any(String) });
    expect(await executeBrainTool(deps(), principal, "get_decision", { sequence: 1 })).toMatchObject({ decision: "signal.promoted", detail: { chunkId: chunk, entityId: entity } });
    expect(await executeBrainTool(deps(), principal, "get_brand_md", {})).toEqual({ markdown: "# Synthetic brand" });
    expect(await executeBrainTool(deps("brain_b"), principal, "get_decision", { sequence: 1 })).toBeNull();
  });
  it("rolls promotion back when decision append fails", async () => {
    const before = (await db.pool.query("select count(*) from brain.validated_context")).rows[0].count;
    const broken = deps();
    const storage: BrainMcpDependencies["storage"] = { withClient: (fn) => broken.storage.withClient(async (client) => fn({ query: async (sql, params) => { if (sql.includes("insert into brain.decisions_log")) throw new Error("audit unavailable"); return client.query(sql, params); } })) };
    await expect(executeBrainTool({ ...broken, storage }, principal, "promote_signal", { chunkId: chunk, entityId: entity, rationale: "Rollback" })).rejects.toThrow("audit unavailable");
    expect((await db.pool.query("select count(*) from brain.validated_context")).rows[0].count).toBe(before);
  });
  it("fails closed with missing RLS context on the restricted role", async () => {
    const client = await db.pool.connect();
    try { await client.query("begin; set local role tenant_app"); expect((await client.query("select * from brain.raw_signal_chunks")).rows).toEqual([]); }
    finally { await client.query("rollback"); client.release(); }
  });
});
