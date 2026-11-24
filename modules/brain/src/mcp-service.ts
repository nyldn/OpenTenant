import type { EmbeddingProvider } from "./embeddings";
import { BrainDecisionChainStore, type DecisionChainClient } from "./decisions-chain";

export interface BrainStorage {
  withClient<T>(fn: (client: DecisionChainClient) => Promise<T>): Promise<T>;
}
export interface ApprovedEmbeddingRoute {
  provider: string;
  model: string;
  region: string;
}
export interface BrainMcpDependencies {
  storage: BrainStorage;
  /** Must resolve through the tenant model-routing policy, before any text is sent. */
  resolveEmbeddingRoute(): Promise<ApprovedEmbeddingRoute>;
  embeddingAdapters: ReadonlyMap<string, EmbeddingProvider>;
}
export const BRAIN_TOOLS = ["search", "get_decision", "get_brand_md", "promote_signal"] as const;
export type BrainTool = typeof BRAIN_TOOLS[number];

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || !/\S/.test(value)) throw new Error("Invalid Brain input");
  return value;
}
function uuid(value: unknown): string {
  const id = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid Brain input");
  return id;
}

/** The caller supplies a live entitlement and a transaction already bound to RLS. */
export async function executeBrainTool(deps: BrainMcpDependencies, principal: {
  tenantId: string; userId: string; permissions: readonly string[];
}, name: BrainTool, args: Record<string, unknown>): Promise<unknown> {
  if (!principal.permissions.includes("brain.use") || (name === "promote_signal" && !principal.permissions.includes("brain.promote"))) throw new Error("Brain permission denied");
  if (name === "search") {
    if (Object.keys(args).some((key) => !["query", "limit"].includes(key))) throw new Error("Invalid Brain input");
    const query = text(args.query, 4000);
    const limit = args.limit ?? 10;
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid Brain input");
    const route = await deps.resolveEmbeddingRoute();
    const adapter = deps.embeddingAdapters.get(route.provider);
    if (!adapter || adapter.dimensions !== 1536) throw new Error("Approved embedding adapter unavailable");
    const embedding = (await adapter.embed([{ id: "query", content: query }]))[0];
    if (!embedding || embedding.provider !== route.provider || embedding.model !== route.model || embedding.vector.length !== 1536 || !embedding.vector.every(Number.isFinite)) throw new Error("Invalid embedding result");
    return deps.storage.withClient(async (client) => (await client.query(
      `select c.id, left(c.content, 8000) as content, 1 - (c.embedding <=> $2::vector) as score,
              (select jsonb_agg(jsonb_build_object('id',v.id,'statement',left(v.statement,8000)))
                 from brain.validated_context v where v.tenant_id=$1 and v.source_chunk_id=c.id and v.trust_tier='validated') as validated
         from brain.raw_signal_chunks c join brain.raw_signals s on s.id=c.raw_signal_id and s.tenant_id=c.tenant_id
        where c.tenant_id=$1 and s.redacted_at is null and s.visibility in ('internal','shared')
          and c.embedding_provider=$3 and c.embedding_model=$4 and c.embedding is not null
        order by c.embedding <=> $2::vector limit $5`,
      [principal.tenantId, JSON.stringify(embedding.vector), route.provider, route.model, limit],
    )).rows);
  }
  if (name === "get_decision") {
    if (Object.keys(args).some((key) => key !== "sequence") || !Number.isSafeInteger(args.sequence) || Number(args.sequence) < 1) throw new Error("Invalid Brain input");
    return deps.storage.withClient(async (client) => (await client.query(
      "select sequence,subject,decision,rationale,outcome,detail,hash,previous_hash from brain.decisions_log where tenant_id=$1 and sequence=$2", [principal.tenantId, args.sequence],
    )).rows[0] ?? null);
  }
  if (name === "get_brand_md") {
    if (Object.keys(args).length) throw new Error("Invalid Brain input");
    return deps.storage.withClient(async (client) => (await client.query(
      "select left(summary,16000) as markdown from brain.entities where tenant_id=$1 and kind='brand' and canonical_name='brand.md'", [principal.tenantId],
    )).rows[0] ?? null);
  }
  if (name !== "promote_signal" || Object.keys(args).some((key) => !["chunkId", "entityId", "rationale"].includes(key))) throw new Error("Invalid Brain input");
  const chunkId = uuid(args.chunkId), entityId = uuid(args.entityId), rationale = text(args.rationale, 2000);
  return deps.storage.withClient(async (client) => {
    const chunk = (await client.query<{ content: string }>(
      `select c.content from brain.raw_signal_chunks c join brain.raw_signals s on s.id=c.raw_signal_id and s.tenant_id=c.tenant_id
        join brain.entities e on e.id=$3 and e.tenant_id=c.tenant_id
       where c.tenant_id=$1 and c.id=$2 and s.redacted_at is null and s.visibility in ('internal','shared') for share of c,e`,
      [principal.tenantId, chunkId, entityId],
    )).rows[0];
    if (!chunk) throw new Error("Brain resource unavailable");
    const actor = { kind: "user" as const, userId: principal.userId };
    const result = await client.query<{ id: string }>(
      `insert into brain.validated_context (tenant_id,entity_id,statement,rationale,trust_tier,source_chunk_id,validated_by)
       values ($1,$2,$3,$4,'validated',$5,$6) returning id`, [principal.tenantId, entityId, chunk.content, rationale, chunkId, JSON.stringify(actor)],
    );
    const chain = new BrainDecisionChainStore({ connect: async () => { throw new Error("Use bound client"); } });
    await chain.appendWithClient(client, { tenantId: principal.tenantId, occurredAt: new Date(), actor, subject: result.rows[0]!.id,
      decision: "signal.promoted", rationale, outcome: "validated", detail: { chunkId, entityId } });
    return result.rows[0];
  });
}
