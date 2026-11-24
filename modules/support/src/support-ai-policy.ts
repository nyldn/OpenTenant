import type { KnowledgeRedaction, SupportAiAuthority } from "./support-ai-types";

export const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const PROMPT_TEMPLATE_VERSION = "support-suggestion-v1";
export const PROVIDER_POLICY_REF = "adr-006";

export function assertSafeReference(value: string, field: string): void {
  if (!SAFE_REF.test(value)) throw new Error(`invalid ${field}`);
}

/**
 * Sentence spans of a knowledge chunk, as offset pairs into its body.
 *
 * A sentence ends at `.`, `!` or `?` when whitespace or the end of the body
 * follows. Leading whitespace is excluded from a span and trailing whitespace
 * from the last one, so a span is always the sentence itself.
 */
export function sentenceSpans(body: string): ReadonlyArray<{ start: number; end: number }> {
  const spans: { start: number; end: number }[] = [];
  const firstNonSpace = (from: number): number => {
    let index = from;
    while (index < body.length && /\s/u.test(body.charAt(index))) index += 1;
    return index;
  };

  let cursor = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body.charAt(index);
    if (character !== "." && character !== "!" && character !== "?") continue;
    const following = index + 1 < body.length ? body.charAt(index + 1) : "";
    if (following !== "" && !/\s/u.test(following)) continue;
    const start = firstNonSpace(cursor);
    if (index + 1 > start) spans.push({ start, end: index + 1 });
    cursor = index + 1;
  }

  const tailStart = firstNonSpace(cursor);
  let tailEnd = body.length;
  while (tailEnd > tailStart && /\s/u.test(body.charAt(tailEnd - 1))) tailEnd -= 1;
  if (tailEnd > tailStart) spans.push({ start: tailStart, end: tailEnd });
  return spans;
}

/**
 * True when a citation covers whole sentences of the chunk it points at.
 *
 * Exact-slice equality alone lets a citation select any substring, so a body
 * reading "You are not eligible after 30 days." can be cited as "eligible after
 * 30 days." The slice matches the source character for character and the claim
 * asserts the opposite of what the source says. Containment is additive and
 * cannot see the dropped negation, so the boundary has to be constrained here:
 * a citation must begin where a sentence begins and end where one ends.
 */
export function citesWholeSentences(body: string, start: number, end: number): boolean {
  const spans = sentenceSpans(body);
  return spans.some((span) => span.start === start) && spans.some((span) => span.end === end);
}

export function canManageKnowledge(authority: SupportAiAuthority): boolean {
  return (
    (authority.kind === "tenant_admin" || authority.kind === "installation_owner") &&
    authority.permissions.includes("support.knowledge.manage")
  );
}

export function canRetrieveKnowledge(authority: SupportAiAuthority): boolean {
  if (authority.kind === "tenant_admin") {
    return authority.permissions.includes("support.ticket.read_tenant");
  }
  return (
    (authority.kind === "installation_owner" || authority.kind === "managed_support") &&
    authority.permissions.includes("owner.support.customer_data.read")
  );
}

/**
 * Overlapping or nested ranges are merged first and the output is built in
 * one pass over the original body. Applying them one at a time would shift
 * offsets, so an outer range could leave part of its text unredacted.
 */
export function applyRedactions(
  body: string,
  redactions: ReadonlyArray<KnowledgeRedaction>,
): string {
  const merged: Array<{ start: number; end: number }> = [];
  for (const item of [...redactions].sort((left, right) => left.start - right.start)) {
    const last = merged.at(-1);
    if (last && item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
    } else {
      merged.push({ start: item.start, end: item.end });
    }
  }
  let redacted = "";
  let cursor = 0;
  for (const range of merged) {
    redacted += `${body.slice(cursor, range.start)}[REDACTED]`;
    cursor = range.end;
  }
  return redacted + body.slice(cursor);
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function containsBannedWord(reply: string, bannedWords: ReadonlyArray<string>): boolean {
  const normalizedReply = reply.toLocaleLowerCase("en-GB").normalize("NFC");
  return bannedWords.some((word) => {
    const normalizedWord = word.toLocaleLowerCase("en-GB").normalize("NFC");
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${escapeRegularExpression(normalizedWord)}(?![\\p{L}\\p{M}\\p{N}])`,
      "u",
    );
    return pattern.test(normalizedReply);
  });
}
