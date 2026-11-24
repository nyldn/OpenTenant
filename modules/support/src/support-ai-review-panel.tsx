"use client";
import type { AiView } from "./support-ai-review-types";
import { useSupportAiReview } from "./support-ai-review-client";
import { FormStatus } from "@opentenant/design-system";

const button = "min-h-11 rounded-md border border-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";
export function SupportAiReviewPanel({ ticketId, ticketVersion, canReview, initialView }: { ticketId: string; ticketVersion: number; canReview: boolean; initialView?: AiView }) {
  const {view,pending,notice,write,fillReplyEditor,cancel} = useSupportAiReview(ticketId,ticketVersion,initialView);
  const suggestion = view?.suggestion;
  const current = view?.visibility === "current" && view?.request?.ticket_version === ticketVersion;
  return <section aria-labelledby="support-ai-heading" className="mt-6 min-w-0 space-y-3 rounded-lg border border-border p-4 text-sm [overflow-wrap:anywhere]">
    <h2 id="support-ai-heading" className="font-display text-base font-semibold">Support AI suggestions</h2>
    <p>Review required. Suggestions do not change the ticket or send a reply.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={pending} onClick={() => void write()}>Request suggestion</button>
      {pending && <button type="button" className={button} onClick={cancel}>Cancel</button>}
    </div>
    {notice && <FormStatus status={notice.status}>{notice.text}</FormStatus>}
    {pending && <p role="status" aria-live="polite">Request in progress.</p>}
    {view?.request && <p>Ticket version {view.request.ticket_version}. {view.visibility === "current" ? "" : `This suggestion is ${view.visibility}.`}</p>}
    {view?.terminal && view.terminal.kind !== "review_required" && <p role="status">{view.terminal.kind.replaceAll("_"," ")}: {view.terminal.reason?.replaceAll("_"," ")}</p>}
    {suggestion && <>
      <p>{suggestion.review === "review_required" ? "Review required" : suggestion.review === "reviewed" ? "Reviewed" : "Dismissed"}</p>
      <p>Suggested category: {suggestion.artifact.category.replaceAll("_"," ")}. Suggested priority: {suggestion.artifact.priority}.</p>
      <blockquote className="whitespace-pre-wrap rounded border border-border p-3">{suggestion.artifact.reply}</blockquote>
      <details><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sources and inference evidence</summary>
        <ul>{suggestion.artifact.claims.map((claim,i) => <li key={i}>{claim.text} Source {claim.citation.chunkId}, characters {claim.citation.start}–{claim.citation.end}.</li>)}</ul>
        <p>Prompt support-suggestion-v1. Scaffold support-scaffold-v1. Model {view?.policy?.provider}/{view?.policy?.model}. Retention {view?.policy?.retentionPosture}. Voice {view?.request?.voice_version ?? "none"} {view?.request?.voice_digest ?? ""}.</p>
      </details>
      {current && canReview && suggestion.review === "review_required" && <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={pending} onClick={() => void write("reviewed")}>Mark reviewed</button>
        <button type="button" className={button} disabled={pending} onClick={() => void write("dismissed")}>Dismiss</button>
      </div>}
      {current && suggestion.review === "reviewed" && <button type="button" className={button} disabled={pending} onClick={() => void fillReplyEditor()}>Use in reply</button>}
    </>}
    {!!view?.history?.length && <details><summary className="cursor-pointer">Earlier suggestions, historical</summary>
      {view.history.map(earlier => <div key={earlier.requestId} className="mt-2 space-y-1 border-t border-border pt-2">
        <p>Historical suggestion for ticket version {earlier.ticketVersion}. {earlier.review.replaceAll("_"," ")}.</p>
        <blockquote className="whitespace-pre-wrap">{earlier.artifact.reply}</blockquote>
      </div>)}
    </details>}
  </section>;
}
