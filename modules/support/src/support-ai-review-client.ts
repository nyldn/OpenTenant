"use client";
import { useEffect, useRef, useState } from "react";
import type { AiView } from "./support-ai-review-types";

export function useSupportAiReview(ticketId: string, ticketVersion: number, initialView?: AiView) {
  const [view,setView] = useState<AiView | null>(initialView ?? null);
  const [pending,setPending] = useState(false);
  const [notice,setNotice] = useState<{ status:"error" | "success"; text:string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const key = useRef<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    setView(initialView ?? null); key.current = null;
    return () => { active.current?.abort(); };
  },[ticketId,ticketVersion,initialView]);
  async function write(review?: "reviewed" | "dismissed") {
    if (busy.current) return;
    busy.current = true; setPending(true); setNotice(null);
    const controller = new AbortController(); active.current = controller;
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/support/ai/suggestions${review ? "/reviews" : ""}`,{ method:"POST",credentials:"same-origin",signal:controller.signal,headers:{ "Content-Type":"application/json" },body:JSON.stringify(review ? { suggestionId:view!.suggestion!.id,decision:review,expectedTicketVersion:ticketVersion } : { ticketId,expectedTicketVersion:ticketVersion,idempotencyKey:key.current }) });
      if (!response.ok) throw new Error("unavailable");
      if (review) {
        setView(current => current?.suggestion ? { ...current,suggestion:{ ...current.suggestion,review } } : current);
        setNotice({ status:"success",text:review === "reviewed" ? "Suggestion reviewed. You can now use it in the reply editor." : "Suggestion dismissed." });
      } else { setView(await response.json() as AiView); key.current = null; }
    } catch { setView(null); setNotice({ status:controller.signal.aborted ? "success" : "error",text:controller.signal.aborted ? "Suggestion request cancelled. Reload to check its recorded outcome." : "Suggestions could not be saved. Reload and try again." }); }
    finally { active.current = null; busy.current = false; setPending(false); }
  }
  function fillReplyEditor() {
    // The human explicitly chooses this previously reviewed artifact. Fresh
    // server page renders hide revoked content; this action submits no form.
    if (busy.current || view?.visibility !== "current" || view.request?.ticket_version !== ticketVersion || view.suggestion?.review !== "reviewed") return;
    const editor = document.getElementById(`support-reply-form-${ticketId}`)?.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    if (!editor) return;
    editor.value = view.suggestion.artifact.reply;
    editor.dispatchEvent(new Event("input",{ bubbles:true })); editor.focus();
    setNotice({ status:"success",text:"Draft added to the reply editor. Review and edit it before pressing Send." });
  }
  return { view,pending,notice,write,fillReplyEditor,cancel: () => active.current?.abort() };
}
