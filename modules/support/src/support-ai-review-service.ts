import { ModelResolutionError, type ModelStreamFailureCode } from "@opentenant/platform-core";
import { PROMPT_TEMPLATE_VERSION } from "./support-ai-policy";
import { validSupportDraft, validSupportAbstention } from "./support-ai-validation";
import { ROUTER_OUTCOMES, type AiActor, type AiAttempt, type AiDependencies, type AiPolicy, type AiRequest, type AiTerminal } from "./support-ai-review-types";
import { PgSupportAiReviewStore, SupportAiConflict, SupportAiEvidenceError } from "./support-ai-review-store";

export class SupportAiStreamError extends Error { constructor(readonly code: ModelStreamFailureCode) { super(code); } }

async function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("cancelled");
  let listener: () => void = () => {};
  const aborted = new Promise<never>((_resolve,reject) => { listener = () => reject(new Error("cancelled")); signal.addEventListener("abort",listener,{once:true}); });
  try { return await Promise.race([operation(),aborted]); } finally { signal.removeEventListener("abort",listener); }
}

export function supportAiFailure(error: unknown): AiTerminal {
  if (error instanceof SupportAiEvidenceError) return { kind:"audit_failure",reason:"support_evidence" };
  if (error instanceof ModelResolutionError || error instanceof SupportAiStreamError) {
    const [kind, reason] = ROUTER_OUTCOMES[error.code];
    return { kind, reason };
  }
  return { kind: "policy_unavailable", reason: "internal_error" };
}
export function matchesAiAttempt(r: AiRequest, p: AiPolicy, a: AiAttempt): boolean {
  return a.tenantId === r.tenant_id && a.moduleId === "support" && a.useCase === "reviewed-suggestion" &&
    a.preparationId === p.preparationId && a.executionId !== a.preparationId &&
    a.provider === p.provider && a.model === p.model && a.region === p.region &&
    a.retentionPosture === p.retentionPosture && a.allowlistVersion === p.allowlistVersion &&
    ["tenant", "installation"].includes(a.credentialOrigin) && a.terminal === "started" &&
    ((p.processingBasis === "tenant_region" && p.consentId === null && p.consentPolicyVersion === null) ||
      (p.processingBasis === "cross_border_consent" && !!p.consentId && !!p.consentPolicyVersion));
}
export class SupportAiReviewService {
  constructor(private readonly store: PgSupportAiReviewStore, private readonly deps: AiDependencies) {}
  async request(actor: AiActor, input: { ticketId: string; expectedTicketVersion: number; idempotencyKey: string }, signal?: AbortSignal) {
    const inputs = await this.store.inputs(actor.tenantId,input.ticketId);
    const previous = await this.store.existing(actor,input.ticketId,input.expectedTicketVersion,input.idempotencyKey);
    if (previous) return this.store.read(actor,input.ticketId,previous.id);
    // Refuse stale input before even loading a voice projection or policy.
    if (inputs.ticket.ticketVersion !== input.expectedTicketVersion) throw new SupportAiConflict();
    let voice;
    let voiceFailed = false;
    try { voice = await this.deps.loadVoice(actor.tenantId); }
    catch { voiceFailed = true; }
    if (voice && (!Number.isInteger(voice.version) || voice.version < 1 || !/^[a-f0-9]{64}$/.test(voice.digest))) voiceFailed = true;
    const begun = await this.store.begin(actor,input.ticketId,input.expectedTicketVersion,input.idempotencyKey,inputs,voiceFailed ? undefined : voice);
    const r = begun.request;
    if (!begun.fresh || begun.refusal) return this.store.read(actor,input.ticketId,r.id);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort",cancel,{ once: true });
    if (signal?.aborted) controller.abort();
    const deadline = setTimeout(cancel,Math.max(1,new Date(r.execution_deadline).getTime()-Date.now()));
    try {
      if (voiceFailed) { await this.store.complete(r,{ kind: "audit_failure", reason: "resolution_evidence" }); return this.store.read(actor,input.ticketId,r.id); }
      if (controller.signal.aborted) { await this.store.complete(r,{ kind: "cancelled", reason: "client_disconnected" }); return this.store.read(actor,input.ticketId,r.id); }
      const policy = await abortable(() => this.deps.inference.prepare(r),controller.signal);
      await this.store.policy(r,policy);
      const opened = await abortable(() => this.deps.inference.open(r,{ ticket: inputs.ticket, knowledge: inputs.knowledge, promptTemplateVersion: PROMPT_TEMPLATE_VERSION },controller.signal),controller.signal);
      if (!matchesAiAttempt(r,policy,opened.attempt) || (begun.controls.synthetic !== (opened.attempt.evidenceOrigin === "synthetic"))) {
        await this.store.complete(r,{ kind: "audit_failure", reason: "resolution_evidence" });
      } else {
        await this.store.start(r,opened.attempt);
        const output = await abortable(opened.run,controller.signal);
        if (controller.signal.aborted) await this.store.complete(r,{ kind: "cancelled", reason: "client_disconnected" });
        else if (!(await abortable(() => this.deps.inference.verify(r,policy,opened.attempt),controller.signal))) await this.store.complete(r,{ kind: "audit_failure", reason: "terminal_evidence" });
        else if (validSupportAbstention(output)) await this.store.complete(r,{ kind: "abstained", reason: output.reason });
        else if (!validSupportDraft(output,inputs.knowledge,voice?.bannedWords ?? [])) {
          try { await this.deps.quarantine(r,output); await this.store.complete(r,{ kind: "unavailable", reason: "invalid_output" }); }
          catch { await this.store.complete(r,{ kind: "audit_failure", reason: "support_evidence" }); }
        } else if (output.confidence < 0.5) await this.store.complete(r,{ kind: "abstained", reason: "low_confidence" });
        else await this.store.complete(r,{ kind: "review_required", reason: null },output,inputs,opened.attempt);
      }
    } catch (error) {
      await this.store.complete(r,controller.signal.aborted ? { kind: "cancelled", reason: "client_disconnected" } : supportAiFailure(error));
    } finally { clearTimeout(deadline); signal?.removeEventListener("abort",cancel); }
    return this.store.read(actor,input.ticketId,r.id);
  }
}