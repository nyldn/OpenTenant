"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, FormStatus, Input } from "@opentenant/design-system";
import { AdminTable } from "../_components/admin-table";
import { listenBrowserEvent } from "@opentenant/platform-core/runtime-globals";
import type { TenantJobStatus } from "../../../lib/tenant-worker-store";

export function TenantActionForm({ action, children, className, onSuccess }: { action: string; children: ReactNode; className?: string; onSuccess?: () => Promise<void> | void }) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const router = useRouter();
  async function submitTenantAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const body = new FormData(event.currentTarget);
    if (submitter?.name) body.set(submitter.name, submitter.value);
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(action, { method: "POST", body });
      if (!response.ok) throw new Error("Action rejected");
      if (response.redirected) { router.push(new URL(response.url).pathname + new URL(response.url).search); return; }
      const location = response.headers.get("location");
      if (location) router.push(location);
      else { setMessage("Action accepted."); if (onSuccess) await onSuccess(); else router.refresh(); }
    } catch { setFailed(true); setMessage("The action could not be completed. Please try again."); }
    finally { busy.current = false; setPending(false); }
  }
  return <form method="post" action={action} onSubmit={submitTenantAction} className={className} aria-busy={pending}><fieldset disabled={pending} className={className ? `min-w-0 ${className}` : "contents"}>{children}</fieldset>{(pending || message) && <FormStatus status={failed ? "error" : "success"}>{pending ? "Working…" : message}</FormStatus>}</form>;
}

type Operations = TenantJobStatus & { canManage: boolean };
const terminal = (status: string) => ["completed", "failed", "cancelled"].includes(status);

function TenantDeletion({ tenant, retentionHours, onSuccess }: { tenant: TenantJobStatus["tenant"]; retentionHours: number; onSuccess: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  function changeOpen(value: boolean) {
    if (busy.current) return;
    setOpen(value); setName(""); setFailed(false);
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || name !== tenant.name) return;
    busy.current = true; setPending(true); setFailed(false);
    try {
      const body = new FormData();
      body.set("action", "delete"); body.set("confirmed", "delete"); body.set("tenantName", name);
      const response = await fetch(`/api/admin/tenants/${tenant.id}/lifecycle`, { method: "POST", body });
      if (!response.ok) throw new Error("Deletion rejected");
      setOpen(false); setName(""); void onSuccess();
    } catch { setFailed(true); }
    finally { busy.current = false; setPending(false); }
  }
  // Compose the shared Dialog for typed confirmation. Its destructive wrapper
  // has no field slot; keep the same focus, dismissal and pending behavior here.
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="destructive">Schedule deletion</Button></DialogTrigger>
    <DialogContent role="alertdialog" aria-busy={pending} showCloseButton={false}
      onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}
      onPointerDownOutside={event => event.preventDefault()}
      onEscapeKeyDown={event => { if (busy.current) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Schedule deletion of {tenant.name}?</DialogTitle>
        <DialogDescription>Access stops immediately. Data is retained for {retentionHours} hours before permanent erasure. You can cancel deletion on this page before the deadline. Once physical erasure starts, the tenant cannot be restored.</DialogDescription>
      </DialogHeader>
      <form onSubmit={confirm}>
        <fieldset disabled={pending} className="space-y-4">
          <label htmlFor="delete-tenant-name">Type the tenant name to confirm: {tenant.name}</label>
          <Input id="delete-tenant-name" name="tenantName" value={name} onChange={event => setName(event.target.value)} autoComplete="off" required />
          {failed && <FormStatus status="error">Deletion could not be scheduled. Please try again.</FormStatus>}
          {pending && <p role="status" aria-live="polite">Scheduling deletion…</p>}
          <DialogFooter>
            <Button ref={cancel} type="button" variant="outline" onClick={() => changeOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending || name !== tenant.name}>Delete {tenant.name}</Button>
          </DialogFooter>
        </fieldset>
      </form>
    </DialogContent>
  </Dialog>;
}

function useTenantProgress(initial: Operations) {
  const [data, setData] = useState<Operations | null>(initial);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  // A failed refresh keeps polling alive even when the cached jobs are all terminal.
  const [stale, setStale] = useState(false);
  const snapshot = useRef(JSON.stringify(initial));
  const failures = useRef(0);
  const revoked = useRef(false);
  const endpoint = `/api/admin/tenants/${initial.tenant.id}/jobs`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (revoked.current) return;
    try {
      const timeout = AbortSignal.timeout(10000);
      const response = await fetch(endpoint, { cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (signal?.aborted || revoked.current) return;
      if ([401, 403, 404].includes(response.status)) {
        revoked.current = true; setData(null); setError("Tenant status is no longer available. Check your access."); return;
      }
      if (!response.ok) throw new Error("Status unavailable");
      const next: Operations = await response.json();
      if (signal?.aborted || revoked.current) return;
      const value = JSON.stringify(next);
      if (snapshot.current !== value) {
        setAnnouncement(`Tenant status: ${next.tenant.status}. ${next.jobs.map(job => `${job.kind}: ${job.status}, attempt ${job.attempts} of 5`).join(". ")}`);
        snapshot.current = value;
      }
      failures.current = 0; setStale(false); setError(""); setData(next);
    } catch {
      if (signal?.aborted) return;
      failures.current += 1; setStale(true);
      setError("Live status is temporarily unavailable. Retrying automatically; you can also try again.");
    }
  }, [endpoint]);
  const running = data?.jobs.some(job => !terminal(job.status)) ?? false;
  useEffect(() => {
    if ((!running && !stale) || revoked.current) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let stopped = false;
    async function poll() {
      if (stopped || inFlight || revoked.current) return;
      if (document.hidden || !navigator.onLine) { timer = setTimeout(poll, 2000); return; }
      inFlight = true;
      await refresh(controller.signal);
      inFlight = false;
      if (stopped || revoked.current) return;
      if (failures.current >= 5) { setError("Live status paused after repeated errors. Try again to resume."); return; }
      timer = setTimeout(poll, failures.current ? Math.min(30000, 5000 * 2 ** (failures.current - 1)) : 2000);
    }
    const wake = () => { clearTimeout(timer); void poll(); };
    timer = setTimeout(poll, 2000);
    document.addEventListener("visibilitychange", wake); const stopOnline = listenBrowserEvent("online", wake);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", wake); stopOnline(); };
  }, [running, stale, refresh, retry]);
  const update = async () => { await refresh(); setRetry(value => value + 1); };
  return { data, announcement, error, update, retryStatus: () => { failures.current = 0; void update(); } };
}

export function TenantOperations({ initial, retentionHours }: { initial: Operations; retentionHours: number }) {
  const { data, announcement, error, update, retryStatus } = useTenantProgress(initial);
  if (!data) return <main className="mx-auto max-w-4xl space-y-6 p-8"><h1>Tenant unavailable</h1><FormStatus status="error">{error}</FormStatus><a href="/admin">Back to tenants</a></main>;
  const { tenant, jobs, canManage } = data;
  return <main className="mx-auto max-w-4xl space-y-6 p-8">
    <a href="/admin">Back to tenants</a>
    <h1 className="text-2xl font-semibold">{tenant.slug}</h1><p>Status: {tenant.status}</p>
    <p role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    {error && <><FormStatus status="error">{error}</FormStatus><Button variant="outline" onClick={retryStatus}>Try status again</Button></>}
    {canManage && <>
      <TenantActionForm action={`/api/admin/tenants/${tenant.id}/lifecycle`} onSuccess={update} className="flex flex-wrap gap-4">
        {tenant.status === "active" && <Button type="submit" name="action" value="suspend">Suspend</Button>}
        {tenant.status === "suspended" && <Button type="submit" name="action" value="resume">Resume</Button>}
        {["active", "suspended"].includes(tenant.status) && <Button type="submit" name="action" value="export">Export</Button>}
      </TenantActionForm>
      {["active", "suspended"].includes(tenant.status) && <TenantDeletion tenant={tenant} retentionHours={retentionHours} onSuccess={update} />}
    </>}
    {tenant.eraseAfter && <section aria-label="Scheduled deletion" className="space-y-3">
      <p>Permanent erasure is scheduled for <time dateTime={tenant.eraseAfter}>{tenant.eraseAfter}</time>. Cancellation restores the tenant&apos;s previous active or suspended state.</p>
      {canManage && <TenantActionForm action={`/api/admin/tenants/${tenant.id}/lifecycle`} onSuccess={update}><Button type="submit" name="action" value="cancel_delete" variant="outline">Cancel scheduled deletion</Button></TenantActionForm>}
      <p>Cancellation is unavailable after the retention deadline or once physical erasure starts.</p>
    </section>}
    <AdminTable name="Tenant jobs" className="caption-top"><caption className="text-left">Tenant jobs. Progress updates automatically while work is pending.</caption><thead><tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Action</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.kind}<br /><small>{job.id}</small></td><td>{job.status}</td><td>{job.attempts}/5</td><td>{canManage && job.status === "failed" && <TenantActionForm action={`/api/admin/tenants/${tenant.id}/jobs/${job.id}`} onSuccess={update}><Button type="submit">Retry job</Button></TenantActionForm>}{job.kind === "export" && job.status === "completed" && <a href={`/api/admin/tenants/${tenant.id}/exports/${job.id}`}>Download export, available for 24 hours</a>}</td></tr>)}</tbody></AdminTable>
  </main>;
}
