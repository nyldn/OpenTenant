import { renderSegments, validateComposition } from "./reply-scaffold";
import { citesWholeSentences, containsBannedWord } from "./support-ai-policy";
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "./types";
import type { KnowledgeChunk, SuggestionDraft } from "./support-ai-types";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));

function citation(value: unknown): boolean {
  return object(value) && keys(value, ["chunkId", "start", "end"]) && typeof value.chunkId === "string" &&
    Number.isInteger(value.start) && Number.isInteger(value.end);
}

/** Adapter data is untrusted even when a TypeScript adapter claims this type. */
export function validSupportDraft(value: unknown, knowledge: readonly KnowledgeChunk[], bannedWords: readonly string[] = []): value is SuggestionDraft {
  if (!object(value) || !keys(value, ["kind", "category", "priority", "reply", "claims", "confidence"], ["segments"]) ||
    value.kind !== "draft" || !TICKET_CATEGORIES.includes(value.category as never) || !TICKET_PRIORITIES.includes(value.priority as never) ||
    typeof value.reply !== "string" || value.reply.length === 0 || value.reply.length > 10000 ||
    typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
    !Array.isArray(value.claims) || value.claims.length === 0 || value.claims.length > 64) return false;
  for (const claim of value.claims) {
    if (!object(claim) || !keys(claim, ["text", "citation"]) || typeof claim.text !== "string" || !citation(claim.citation)) return false;
    const span = claim.citation as { chunkId: string; start: number; end: number };
    const chunk = knowledge.find(item => item.chunkId === span.chunkId);
    if (!chunk || span.start < 0 || span.end <= span.start || span.end > chunk.body.length ||
      chunk.body.slice(span.start, span.end) !== claim.text || !citesWholeSentences(chunk.body, span.start, span.end)) return false;
  }
  const draft = value as unknown as SuggestionDraft;
  if (Object.hasOwn(value, "segments")) {
    if (!Array.isArray(value.segments) || value.segments.length > 128) return false;
    for (const segment of value.segments) {
      if (!object(segment)) return false;
      if (segment.kind === "scaffold") { if (!keys(segment, ["kind", "id"]) || typeof segment.id !== "string") return false; }
      else if (segment.kind === "claim") {
        if (!keys(segment, ["kind", "text", "citation"]) || !citation(segment.citation) ||
          !draft.claims.some(claim => claim.text === segment.text && claim.citation.chunkId === (segment.citation as Record<string,unknown>).chunkId && claim.citation.start === (segment.citation as Record<string,unknown>).start && claim.citation.end === (segment.citation as Record<string,unknown>).end)) return false;
      } else return false;
    }
    if (validateComposition(draft.segments!, draft.reply).length || renderSegments(draft.segments!) !== draft.reply) return false;
  } else if (draft.reply !== draft.claims.map(claim => claim.text).join(" ")) return false;
  return !containsBannedWord(draft.reply, bannedWords);
}

export function validSupportAbstention(value: unknown): value is { kind: "abstain"; reason: "low_confidence" | "insufficient_information" } {
  return object(value) && keys(value,["kind","reason"]) && value.kind === "abstain" &&
    (value.reason === "low_confidence" || value.reason === "insufficient_information");
}
