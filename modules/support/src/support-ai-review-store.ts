import { getTicket, type SupportClient } from "./ticket-store";
import { PROMPT_TEMPLATE_VERSION, sha256 } from "./support-ai-policy";
import { SUPPORT_SCAFFOLD_VERSION } from "./reply-scaffold";
import { validSupportDraft } from "./support-ai-validation";
import type { AppliedSupportVoiceProfile, SuggestionDraft } from "./support-ai-types";
import type { AiActor, AiArtifact, AiAttempt, AiControls, AiInputs, AiPolicy, AiRequest, AiTerminal, AiTransaction, AiView } from "./support-ai-review-types";

export class SupportAiConflict extends Error {}
export class SupportAiNotFound extends Error {}
export class SupportAiEvidenceError extends Error {}
const off: AiControls = { enabled: false, synthetic: false, epoch: 1, daily_limit: 0, actor_hourly_limit: 0, retention_days: 30 };
async function audit(client: SupportClient, request: AiRequest, actorId: string, action: string, reason: string | null = null, digest: string | null = null) {
  await client.query(`insert into support.ai_suggestion_audit_events(tenant_id,request_id,actor_id,action,reason,artifact_digest) values ($1,$2,$3,$4,$5,$6)`, [request.tenant_id, request.id, actorId, action, reason, digest]);
}
export async function readAiInputs(client: SupportClient, tenantId: string, ticketId: string): Promise<AiInputs> {
  const detail = await getTicket(client, tenantId, ticketId);
  if (!detail) throw new SupportAiNotFound();
  const t = detail.ticket;
  const articles = (await client.query<{ id: string; title: string; content: string }>(`select id,title,content from support.knowledge_articles where tenant_id=$1 and status='published' order by id limit 32`, [tenantId])).rows;
  const knowledge: AiInputs["knowledge"][number][] = [];
  const sources: AiInputs["sources"][number][] = [];
  for (const article of articles) {
    // A bounded article is one deterministic chunk. Oversized material is ineligible,
    // never truncated in the middle of a sentence or a qualifying paragraph.
    if (!article.content.trim() || article.content.length > 8000) continue;
    const digest = await sha256(JSON.stringify({ title: article.title, content: article.content }));
    const chunkId = `${article.id}:${digest}:0`;
    knowledge.push({ chunkId, articleId: article.id, body: article.content, provenance: [{ sourceRef: article.id, sourceVersion: digest }] });
    sources.push({ articleId: article.id, chunkId, digest });
    if (knowledge.reduce((n, chunk) => n + chunk.body.length, 0) >= 32000) break;
  }
  return { ticket: { ticketId: t.id, ticketVersion: t.version, subject: t.subject, body: t.description,
    publicReplies: detail.messages.filter(m => m.messageType === "reply").map(m => m.body), category: t.category, priority: t.priority, status: t.status, tags: [], attachments: [] }, knowledge, sources };
}
export class PgSupportAiReviewStore {
  constructor(readonly transaction: AiTransaction) {}
  private async evidence<T>(tenantId: string, work: (client: SupportClient) => Promise<T>): Promise<T> {
    try { return await this.transaction(tenantId,work); } catch { throw new SupportAiEvidenceError(); }
  }
  async controls(tenantId: string): Promise<AiControls> {
    return this.transaction(tenantId, async c => (await c.query<AiControls>("select * from support.ai_controls where tenant_id=$1", [tenantId])).rows[0] ?? off);
  }
  inputs(tenantId: string, ticketId: string) { return this.transaction(tenantId, c => readAiInputs(c, tenantId, ticketId)); }
  async existing(actor: AiActor, ticketId: string, version: number, key: string) {
    return this.transaction(actor.tenantId, async c => {
      const r = (await c.query<AiRequest>("select * from support.ai_suggestion_requests where tenant_id=$1 and actor_id=$2 and idempotency_key=$3", [actor.tenantId,actor.actorId,key])).rows[0];
      if (r && (r.ticket_id !== ticketId || r.ticket_version !== version)) throw new SupportAiConflict();
      return r;
    });
  }
  async begin(actor: AiActor, ticketId: string, version: number, key: string, inputs: AiInputs, voice?: AppliedSupportVoiceProfile): Promise<{ request: AiRequest; fresh: boolean; controls: AiControls; refusal: AiTerminal | null }> {
    const inputDigest = await sha256(JSON.stringify({ template: PROMPT_TEMPLATE_VERSION, scaffold: SUPPORT_SCAFFOLD_VERSION, ticket: inputs.ticket, knowledge: inputs.knowledge, voice: voice ? { version: voice.version, digest: voice.digest } : null }));
    return this.transaction(actor.tenantId, async c => {
      // Serializes tenant budget admission and same-key races, never a ticket mutation.
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`support-ai:${actor.tenantId}`]);
      const controls = (await c.query<AiControls>("select * from support.ai_controls where tenant_id=$1 for share", [actor.tenantId])).rows[0] ?? off;
      const old = (await c.query<AiRequest>("select * from support.ai_suggestion_requests where tenant_id=$1 and actor_id=$2 and idempotency_key=$3", [actor.tenantId, actor.actorId, key])).rows[0];
      if (old) {
        if (old.ticket_id !== ticketId || old.ticket_version !== version) throw new SupportAiConflict();
        return { request: old, fresh: false, controls, refusal: null };
      }
      // Canonical ticket is locked against concurrent replies/triage until the input
      // watermark is committed. Model work happens after releasing this lock.
      const current = (await c.query<{ version: number }>("select version from support.tickets where tenant_id=$1 and id=$2 for share", [actor.tenantId, ticketId])).rows[0];
      if (!current) throw new SupportAiNotFound();
      if (Number(current.version) !== version || inputs.ticket.ticketVersion !== version) throw new SupportAiConflict();
      const used = (await c.query<{ daily: string; hourly: string }>(`select count(*) filter(where created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC') as daily,
        count(*) filter(where actor_id=$2 and created_at>clock_timestamp()-interval '1 hour') as hourly
        from support.ai_suggestion_requests where tenant_id=$1 and admitted and created_at>clock_timestamp()-interval '1 day'`, [actor.tenantId, actor.actorId])).rows[0]!;
      let refusal: AiTerminal | null = null;
      if (!controls.enabled) refusal = { kind: "unavailable", reason: "disabled" };
      else if (["resolved", "closed"].includes(inputs.ticket.status)) refusal = { kind: "unsupported_request", reason: "ticket_state" };
      else if (Number(used.daily) >= controls.daily_limit) refusal = { kind: "unavailable", reason: "budget_exhausted" };
      else if (Number(used.hourly) >= controls.actor_hourly_limit) refusal = { kind: "unavailable", reason: "rate_limited" };
      else if (!inputs.knowledge.length) refusal = { kind: "unavailable", reason: "no_knowledge" };
      const request = (await c.query<AiRequest>(`insert into support.ai_suggestion_requests(tenant_id,ticket_id,ticket_version,actor_id,idempotency_key,input_digest,input_watermark,sources,voice_version,voice_digest,control_epoch,admitted,retention_until)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,clock_timestamp()+$13*interval '1 day') returning *`,
        [actor.tenantId,ticketId,version,actor.actorId,key,inputDigest,`${ticketId}:v${version}:replies${inputs.ticket.publicReplies.length}`,JSON.stringify(inputs.sources),voice?.version ?? null,voice?.digest ?? null,controls.epoch,!refusal,controls.retention_days])).rows[0]!;
      await audit(c, request, actor.actorId, "requested");
      if (refusal) await this.insertTerminal(c, request, refusal);
      return { request, fresh: true, controls, refusal };
    });
  }
  async policy(request: AiRequest, policy: AiPolicy) {
    await this.evidence(request.tenant_id, async c => {
      await c.query("select id from support.ai_suggestion_requests where tenant_id=$1 and id=$2 for update", [request.tenant_id,request.id]);
      await c.query("insert into support.ai_suggestion_policy_snapshots(tenant_id,request_id,preparation_id,policy) values ($1,$2,$3,$4::jsonb)", [request.tenant_id,request.id,policy.preparationId,JSON.stringify(policy)]);
      await audit(c,request,request.actor_id,"policy_resolved");
    });
  }
  async start(request: AiRequest, attempt: AiAttempt) {
    await this.evidence(request.tenant_id, async c => {
      await c.query("insert into support.ai_suggestion_attempts(tenant_id,request_id,preparation_id,execution_id,attempt) values ($1,$2,$3,$4,$5::jsonb)", [request.tenant_id,request.id,attempt.preparationId,attempt.executionId,JSON.stringify(attempt)]);
      await audit(c,request,request.actor_id,"provider_started");
    });
  }
  async complete(request: AiRequest, terminal: AiTerminal, draft?: SuggestionDraft, inputs?: AiInputs, attempt?: AiAttempt): Promise<void> {
    await this.evidence(request.tenant_id, async c => {
      const row = (await c.query<AiRequest>("select * from support.ai_suggestion_requests where tenant_id=$1 and id=$2 for update", [request.tenant_id,request.id])).rows[0];
      if (!row) throw new SupportAiNotFound();
      if ((await c.query("select 1 from support.ai_suggestion_terminals where tenant_id=$1 and request_id=$2", [request.tenant_id,request.id])).rows.length) return;
      if (!(await c.query("select 1 from support.ai_suggestion_requests where tenant_id=$1 and id=$2 and execution_deadline>clock_timestamp()", [request.tenant_id,request.id])).rows.length) return;
      if (draft) {
        const state = await this.visibility(c, request);
        if (state !== "current") { terminal = { kind: state === "stale" ? "ticket_stale" : "unavailable", reason: state === "stale" ? "version_changed" : "disabled" }; draft = undefined; }
      }
      if (draft) {
        if (!inputs || !attempt || !validSupportDraft(draft, inputs.knowledge)) throw new SupportAiConflict("invalid durable artifact");
        const artifact: AiArtifact = { category: draft.category, priority: draft.priority, reply: draft.reply, claims: draft.claims, ...(draft.segments ? { segments: draft.segments } : {}), sources: request.sources, schemaVersion: 1 };
        const result = (await c.query<{ id: string; artifact_digest: string }>(`insert into support.ai_suggestions(tenant_id,request_id,artifact,artifact_digest)
          values($1,$2,$3::jsonb,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex')) returning id,artifact_digest`, [request.tenant_id,request.id,JSON.stringify(artifact)])).rows[0]!;
        terminal = { kind: "review_required", reason: null, suggestion_id: result.id, artifact_digest: result.artifact_digest };
      }
      await this.insertTerminal(c,request,terminal);
    });
  }
  private async insertTerminal(c: SupportClient, r: AiRequest, terminal: AiTerminal) {
    await c.query("insert into support.ai_suggestion_terminals(tenant_id,request_id,kind,reason,suggestion_id,artifact_digest) values ($1,$2,$3,$4,$5,$6)", [r.tenant_id,r.id,terminal.kind,terminal.reason,terminal.suggestion_id ?? null,terminal.artifact_digest ?? null]);
    await audit(c,r,r.actor_id,terminal.kind === "review_required" ? "suggestion_created" : "terminal",terminal.reason,terminal.artifact_digest);
  }
  private async visibility(c: SupportClient, r: AiRequest): Promise<AiView["visibility"]> {
    const controls = (await c.query<AiControls>("select * from support.ai_controls where tenant_id=$1 for share", [r.tenant_id])).rows[0] ?? off;
    if (!controls.enabled || controls.epoch !== r.control_epoch) return "revoked";
    if (!(await c.query("select 1 from support.ai_suggestion_requests where tenant_id=$1 and id=$2 and retention_until>clock_timestamp()", [r.tenant_id,r.id])).rows.length) return "expired";
    const inputs = await readAiInputs(c,r.tenant_id,r.ticket_id);
    if (r.sources.some(source => !inputs.sources.some(current => current.chunkId === source.chunkId && current.digest === source.digest))) return "revoked";
    return inputs.ticket.ticketVersion === r.ticket_version && !["resolved","closed"].includes(inputs.ticket.status) ? "current" : "stale";
  }
  async read(actor: AiActor, ticketId: string, requestId?: string): Promise<AiView> {
    return this.transaction(actor.tenantId, async c => {
      if (!(await c.query("select 1 from support.tickets where tenant_id=$1 and id=$2", [actor.tenantId,ticketId])).rows.length) throw new SupportAiNotFound();
      const r = (await c.query<AiRequest>("select * from support.ai_suggestion_requests where tenant_id=$1 and ticket_id=$2 and ($3::uuid is null or id=$3) order by created_at desc,id desc limit 1", [actor.tenantId,ticketId,requestId ?? null])).rows[0];
      if (!r) return { request: null, terminal: null, suggestion: null, visibility: "current", policy: null };
      const visibility = await this.visibility(c,r);
      const terminal = (await c.query<AiTerminal>("select kind,reason,suggestion_id,artifact_digest from support.ai_suggestion_terminals where tenant_id=$1 and request_id=$2", [actor.tenantId,r.id])).rows[0] ?? (new Date(r.execution_deadline).getTime() <= Date.now() ? { kind: "interrupted", reason: "execution_deadline" } as const : null);
      const content = visibility === "revoked" || visibility === "expired" ? undefined : (await c.query<{ id: string; artifact: AiArtifact; digest: string; review: "review_required" | "reviewed" | "dismissed" }>(`select s.id,s.artifact,s.artifact_digest as digest,coalesce(v.decision,'review_required') as review from support.ai_suggestions s
        left join support.ai_suggestion_reviews v on v.tenant_id=s.tenant_id and v.suggestion_id=s.id where s.tenant_id=$1 and s.request_id=$2`, [actor.tenantId,r.id])).rows[0];
      const policy = (await c.query<{ policy: AiPolicy }>("select policy from support.ai_suggestion_policy_snapshots where tenant_id=$1 and request_id=$2", [actor.tenantId,r.id])).rows[0]?.policy ?? null;
      const previous = (await c.query<AiRequest & { artifact: AiArtifact; review: "review_required" | "reviewed" | "dismissed" }>(`select r.*,s.artifact,coalesce(v.decision,'review_required') as review
        from support.ai_suggestion_requests r join support.ai_suggestions s on s.tenant_id=r.tenant_id and s.request_id=r.id
        left join support.ai_suggestion_reviews v on v.tenant_id=s.tenant_id and v.suggestion_id=s.id
        where r.tenant_id=$1 and r.ticket_id=$2 and r.id<>$3 order by r.created_at desc,r.id desc limit 5`, [actor.tenantId,ticketId,r.id])).rows;
      const history: NonNullable<AiView["history"]> = [];
      for (const earlier of previous) {
        const state = await this.visibility(c,earlier);
        if (state === "current" || state === "stale") history.push({ requestId:earlier.id,ticketVersion:earlier.ticket_version,artifact:earlier.artifact,review:earlier.review });
      }
      return { request: r, terminal, suggestion: content ?? null, visibility, policy, history };
    });
  }
  async review(actor: AiActor, suggestionId: string, version: number, decision: "reviewed" | "dismissed") {
    return this.transaction(actor.tenantId, async c => {
      const r = (await c.query<AiRequest>(`select r.* from support.ai_suggestion_requests r join support.ai_suggestions s on s.tenant_id=r.tenant_id and s.request_id=r.id where r.tenant_id=$1 and s.id=$2 for update of r`, [actor.tenantId,suggestionId])).rows[0];
      if (!r) throw new SupportAiNotFound();
      await c.query("select id from support.tickets where tenant_id=$1 and id=$2 for share", [actor.tenantId,r.ticket_id]);
      if (version !== r.ticket_version || await this.visibility(c,r) !== "current") throw new SupportAiConflict();
      const inserted = await c.query("insert into support.ai_suggestion_reviews(tenant_id,request_id,suggestion_id,actor_id,decision,ticket_version) values ($1,$2,$3,$4,$5,$6) on conflict(tenant_id,suggestion_id) do nothing returning id", [actor.tenantId,r.id,suggestionId,actor.actorId,decision,version]);
      if (!inserted.rows.length) throw new SupportAiConflict();
      await audit(c,r,actor.actorId,decision);
    });
  }
}
