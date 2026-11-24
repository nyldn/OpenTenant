"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormField, FormStatus, Input, SharedForm } from "@opentenant/design-system";
export function OwnerClaimForm({ tenantId, initialJob = null, failed = false }: { tenantId: string; initialJob?: string | null; failed?: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<string | null>(initialJob);
  const [status, setStatus] = useState("pending");
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (failed) summary.current?.focus(); }, [failed]);
  const endpoint = `/api/admin/tenants/${encodeURIComponent(tenantId)}/owner-claim`;
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function poll() {
      try {
        const response = await fetch(`${endpoint}?job=${encodeURIComponent(job!)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Job unavailable");
        const body = await response.json();
        if (["completed", "failed"].includes(body.status)) { setStatus(body.status); return; }
        if (++attempts >= 60) { setStatus("delayed"); return; }
        timer = setTimeout(poll, 2000);
      } catch { if (!controller.signal.aborted) setStatus("delayed"); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job, endpoint]);
  if (job) return <>
    <FormStatus status={status === "failed" || status === "delayed" ? "error" : "success"}>{status === "completed" ? "Ownership granted. Your tenant is ready." : status === "failed" || status === "delayed" ? "Your claim was saved, but the ownership grant needs attention. Ask your operator to check the owner-grant job. Do not reuse the token." : "Claim saved. Waiting for the ownership grant."}</FormStatus>
    {status === "completed" && <a href="/" className="inline-flex min-h-11 items-center underline">Open tenant</a>}
  </>;
  const nativeAction = { action: endpoint };
  return <>
  {failed && <div ref={summary} tabIndex={-1}><FormStatus status="error">This claim is unavailable. Use the separate owner token with the invited email. Ask your operator for a new token if it expired or was already used.</FormStatus></div>}
  <SharedForm {...nativeAction} method="post" id="owner-claim" submitLabel="Claim ownership" pendingLabel="Claiming ownership…" onSubmit={async data => {
    const response = await fetch(endpoint, { method: "POST", body: data, headers: { accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) return { status: "error", message: result.error };
    setJob(result.jobId);
    router.replace(`/admin/tenants/${encodeURIComponent(tenantId)}/owner-claim?job=${encodeURIComponent(result.jobId)}`);
    return { status: "success", message: "Claim saved. Waiting for the ownership grant." };
  }}><FormField name="token" label="Owner claim token" help="Use the separate token supplied by your operator, rather than the invitation reference.">{control => <Input {...control} type="password" required autoComplete="off" />}</FormField></SharedForm></>;
}
