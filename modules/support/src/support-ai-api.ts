import type { ModuleHostServices } from "@opentenant/database/module-host";
import type { TenantId } from "@opentenant/auth";
import { ModelResolutionError } from "@opentenant/platform-core";
import { createSupportContext, type SupportContext } from "./host-context";
import { PgSupportAiReviewStore, SupportAiConflict, SupportAiNotFound } from "./support-ai-review-store";
import { SupportAiReviewService } from "./support-ai-review-service";
import { syntheticSupportAi } from "./support-ai-review-synthetic";
import { SUPPORT_AI_PERMISSIONS, type AiActor, type AiDependencies } from "./support-ai-review-types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const supportAiUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const version = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
export function validAiCreate(value: Record<string,unknown>): value is { ticketId: string; expectedTicketVersion: number; idempotencyKey: string } {
  return Object.keys(value).length === 3 && supportAiUuid(value.ticketId) && version(value.expectedTicketVersion) &&
    typeof value.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value.idempotencyKey);
}
export function validAiReview(value: Record<string,unknown>): value is { suggestionId: string; expectedTicketVersion: number; decision: "reviewed" | "dismissed" } {
  return Object.keys(value).length === 3 && supportAiUuid(value.suggestionId) && version(value.expectedTicketVersion) && (value.decision === "reviewed" || value.decision === "dismissed");
}
export async function supportAiCapabilities(host: ModuleHostServices, context: SupportContext) {
  const session = context.session;
  if (session.activeTenantId !== context.tenantId || session.isPlatformAdmin || !context.capabilities.readTenant || !context.capabilities.replyTenant) return { suggest: false, review: false };
  const permissions = await host.resolvePermissions(session,context.tenantId,"support");
  return { suggest: permissions.includes(SUPPORT_AI_PERMISSIONS.suggest), review: permissions.includes(SUPPORT_AI_PERMISSIONS.review) };
}
async function boundedJson(req: Request): Promise<Record<string,unknown> | null> {
  if (req.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" || !req.body) return null;
  const reader = req.body.getReader();
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return null; }
      chunks.push(result.value);
    }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk,offset); offset += chunk.length; }
    const result: unknown = JSON.parse(new TextDecoder("utf-8",{ fatal:true }).decode(buffer));
    return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string,unknown> : null;
  } catch { return null; } finally { reader.releaseLock(); }
}
const json = (value: unknown, status = 200) => Response.json(value,{ status, headers: { "Cache-Control":"no-store" } });
const unconfigured: AiDependencies = {
  loadVoice: async () => { throw new Error("applied voice evidence port unavailable"); },
  quarantine: async () => { throw new Error("owner quarantine unavailable"); },
  inference: { prepare: async () => { throw new ModelResolutionError("POLICY_STORE_UNAVAILABLE","routing evidence unavailable"); }, open: async () => { throw new Error("unconfigured"); }, verify: async () => false },
};
/** No ticket mutator, delivery service or publication port is in this composition. */
export function createSupportAiApi(host: ModuleHostServices, dependencies?: AiDependencies) {
  const context = createSupportContext(host);
  const store = new PgSupportAiReviewStore((tenant,work) => host.withTenantDb(tenant as TenantId,work));
  return async (req: Request): Promise<Response> => {
    try {
      const gate = await context();
      if (!gate.ok) return gate.response ?? json({ error:"not found" },404);
      const capabilities = await supportAiCapabilities(host,gate.context);
      const isReview = new URL(req.url).pathname.endsWith("/reviews");
      if (!capabilities.suggest || (isReview && !capabilities.review)) return json({ error:"not found" },404);
      const actor: AiActor = { tenantId:gate.context.tenantId,actorId:gate.context.session.userId,kind:"tenant_admin" };
      if (req.method === "GET" && !isReview) {
        const search = new URL(req.url).searchParams;
        if ([...search.keys()].length !== 1 || !supportAiUuid(search.get("ticketId"))) return json({ error:"invalid request" },400);
        return json(await store.read(actor,search.get("ticketId")!));
      }
      if (req.method !== "POST") return json({ error:"method not allowed" },405);
      if (!host.sameOrigin(req)) return json({ error:"forbidden" },403);
      const limited = await host.enforceMutationRateLimit(req,gate.context); if (limited) return limited;
      if (new URL(req.url).search) return json({ error:"invalid request" },400);
      const body = await boundedJson(req);
      if (!body) return json({ error:"invalid request" },400);
      if (isReview) {
        if (!validAiReview(body)) return json({ error:"invalid request" },400);
        await store.review(actor,body.suggestionId,body.expectedTicketVersion,body.decision);
        return json({ decision:body.decision });
      }
      if (!validAiCreate(body)) return json({ error:"invalid request" },400);
      const controls = await store.controls(actor.tenantId);
      // Synthetic mode requires privileged tenant-local configuration. It never
      // selects a live provider or uses an ambient provider credential.
      const deps = dependencies ?? (controls.synthetic ? syntheticSupportAi() : unconfigured);
      const result = await new SupportAiReviewService(store,deps).request(actor,body,req.signal);
      // Permission or module revocation during inference also conceals its result.
      const fresh = await context();
      if (!fresh.ok || fresh.context.tenantId !== actor.tenantId || fresh.context.session.userId !== actor.actorId || !(await supportAiCapabilities(host,fresh.context)).suggest) return json({ error:"not found" },404);
      return json(result);
    } catch (error) {
      if (error instanceof SupportAiNotFound) return json({ error:"not found" },404);
      if (error instanceof SupportAiConflict) return json({ error:"suggestion is stale or already reviewed" },409);
      return json({ error:"suggestions are temporarily unavailable" },503);
    }
  };
}
