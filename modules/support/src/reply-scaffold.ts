/**
 * The frozen scaffold: the only words a support reply may contain that were not
 * copied verbatim from a cited source.
 *
 * Composed replies are a deliberate trade, ruled by the owner on 2026-08-03.
 * Before it, a reply was its cited sentences concatenated, and the containment
 * rule was string equality: the model could not invent a promise because
 * inventing anything at all broke the check. That is a crude property and a
 * very strong one, and readable replies cost it.
 *
 * This module keeps as much of it as composition allows. The model does not
 * write scaffold prose; it selects a scaffold phrase **by id** from the closed
 * table below. Every character of a composed reply therefore comes from either
 * a cited span or this file, and this file is reviewed like code and versioned
 * like a contract. The model chooses arrangement, never wording.
 *
 * What this does NOT prevent, stated plainly because the boundary document now
 * depends on it: a model may order claims so that two individually accurate
 * sentences imply something the source never said. That is recombination, it
 * was impossible under concatenation, and it is possible here. The human
 * approver is the control, per the review-required authority in
 * `docs/product/support-ai-boundary.md` section 4.
 */

export const SUPPORT_SCAFFOLD_VERSION = "support-scaffold-v1";

/**
 * Every permitted non-cited phrase, keyed by id.
 *
 * Rules for anything added here, all of them load-bearing:
 *
 * - **No addressee names.** The boundary document's allowed-input list refuses
 *   the requester's display name, so a composed reply cannot greet by name. A
 *   template placeholder would smuggle a prohibited field back in.
 * - **No claims.** Nothing here may assert anything about the product, an
 *   account, a policy, or an outcome. Scaffold is connective tissue only. If a
 *   phrase would still be true when the entire ticket is about something else,
 *   it qualifies; otherwise it is a claim and belongs in a cited span.
 * - **No URLs, addresses, or contact routes.** Those must come from a cited
 *   source, and the containment gate's URL rule has no scaffold exemption.
 * - **No commitments.** "We will fix this" is a promise; "Thanks for getting in
 *   touch" is not.
 *
 * Adding an entry is a reviewed change to a safety surface, not a copy edit.
 */
export const SUPPORT_SCAFFOLD = Object.freeze({
  greeting_plain: "Hello,",
  ack_received: "Thanks for getting in touch.",
  ack_checked: "I've checked our documentation on this.",
  transition_here: "Here's what applies:",
  transition_also: "Also worth knowing:",
  closing_help: "I hope that helps.",
  closing_followup: "If that doesn't resolve it, reply here and we'll take another look.",
  signoff_plain: "Best,",
  signoff_team: "Support",
}) satisfies Readonly<Record<string, string>>;

export type ScaffoldId = keyof typeof SUPPORT_SCAFFOLD;

export type ReplySegment =
  | { kind: "claim"; text: string; citation: { chunkId: string; start: number; end: number } }
  | { kind: "scaffold"; id: ScaffoldId };

export function isScaffoldId(value: string): value is ScaffoldId {
  return Object.prototype.hasOwnProperty.call(SUPPORT_SCAFFOLD, value);
}

/**
 * The rendered reply for a segment list.
 *
 * Rendering is the single source of truth for the final string. A draft carries
 * a `reply` as well, and `validateComposition` requires the two to match
 * exactly, so the model cannot describe one reply in segments and send another.
 */
export function renderSegments(segments: ReadonlyArray<ReplySegment>): string {
  return segments
    .map((segment) => (segment.kind === "claim" ? segment.text : SUPPORT_SCAFFOLD[segment.id]))
    .join(" ");
}

export interface CompositionProblem {
  readonly index: number;
  readonly reason: string;
}

/**
 * Structural validation of a composed reply, independent of the citations.
 *
 * Citation correctness stays where it was, in `validDraft`, because it needs the
 * retrieved chunks. This function answers the questions that need only the
 * segments: is every scaffold id real, is there anything actually grounded in
 * here, and does the rendered text match what the draft claims to be sending.
 */
export function validateComposition(
  segments: ReadonlyArray<ReplySegment>,
  reply: string,
): ReadonlyArray<CompositionProblem> {
  const problems: CompositionProblem[] = [];
  if (segments.length === 0) {
    return [{ index: -1, reason: "a composed reply needs at least one segment" }];
  }

  segments.forEach((segment, index) => {
    if (segment.kind === "scaffold") {
      // The id is the whole point: a model that could supply scaffold *text*
      // could write anything and call it a greeting.
      if (!isScaffoldId(segment.id)) {
        problems.push({ index, reason: `unknown scaffold id "${String(segment.id)}"` });
      }
      return;
    }
    if (typeof segment.text !== "string" || segment.text.trim() === "") {
      problems.push({ index, reason: "a claim segment needs text" });
    }
  });

  // A reply made only of scaffold answers nothing while sounding helpful, which
  // is worse than abstaining because it reads as an answer.
  if (!segments.some((segment) => segment.kind === "claim")) {
    problems.push({ index: -1, reason: "a reply with no cited claim is not grounded" });
  }

  if (problems.length === 0 && renderSegments(segments) !== reply) {
    problems.push({ index: -1, reason: "reply text does not match its segments" });
  }

  return problems;
}
