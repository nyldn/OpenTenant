"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormInput, FormStatus, SharedForm, type FormOutcome } from "@opentenant/design-system";
import type { TenantDomainSetting } from "../../../lib/tenant-domain-settings";

export function CustomDomainsForm({ domains }: { domains: TenantDomainSetting[] }) {
  const router = useRouter();
  const [challenge, setChallenge] = useState<{ host: string; record: string; token: string } | null>(null);
  const [copyError, setCopyError] = useState(false);
  async function submit(form: FormData): Promise<FormOutcome> {
    try {
      const response = await fetch("/api/settings/domains", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) return { status: "error", message: "Domain operation failed. Check the subdomain and try again." };
      if (result.token) setChallenge({ host: result.host, record: result.record, token: result.token });
      if (result.removed && challenge?.host === form.get("host")) setChallenge(null);
      router.refresh();
      return result.verification === "failed"
        ? { status: "error", message: "TXT record not verified. Check the record name and value, allow time for DNS propagation and try again. Reissue the challenge if the value is lost or expired." }
        : { status: "success", message: result.token ? "TXT challenge saved. Publish the new value in DNS." : "Domain changes saved." };
    } catch { return { status: "error", message: "Domain operation failed. Check your connection and try again." }; }
  }
  return <section className="mt-6 min-w-0 space-y-4" aria-label="Custom domains">
    <SharedForm submitLabel="Add custom domain" onSubmit={submit} className="min-w-0 space-y-3">
      <input type="hidden" name="action" value="add" />
      <FormInput name="host" label="Custom subdomain" required maxLength={253} placeholder="app.customer.test" />
    </SharedForm>
    {challenge ? <div className="min-w-0 space-y-3 rounded-md border border-border bg-card p-4 text-card-foreground">
      <p>Publish this DNS TXT record. Keep the value in DNS. It is shown for this visit only; reissue it here after loss or expiry.</p>
      <p>Record name: <code className="break-all" data-testid="challenge-record">{challenge.record}</code></p>
      <p>TXT value: <code className="break-all" data-testid="challenge-token">{challenge.token}</code></p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(`${challenge.record}\tTXT\t${challenge.token}`); setCopyError(false); } catch { setCopyError(true); } }}>Copy TXT record</Button>
        <a className="inline-flex min-h-11 items-center underline" download="domain-challenge.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`${challenge.record}\tTXT\t${challenge.token}\n`)}`}>Download TXT record</a>
      </div>
      {copyError ? <FormStatus status="error">Copy is unavailable. Select the record text or download it.</FormStatus> : null}
    </div> : null}
    {domains.map(domain => <div key={domain.host} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground" data-testid="custom-domain">
      <h2 className="break-all font-semibold">{domain.host}</h2><p>{domain.active ? "active" : domain.verification}</p>
      <p>TXT record name: <code className="break-all">{domain.challengeRecord ?? `_opentenant-challenge.${domain.host}`}</code></p>
      {domain.challengeExpiresAt ? <p>Challenge expires: <time dateTime={domain.challengeExpiresAt}>{new Date(domain.challengeExpiresAt).toUTCString()}</time></p> : null}
      <p className="text-sm text-muted-foreground">Lost or expired TXT value? Reissue the challenge, replace the old TXT value in DNS, then verify. Reissuing deactivates this domain until the new challenge is verified.</p>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
        {[["verify", "Verify DNS"], ["reissue", "Reissue TXT challenge"], ["remove", "Remove domain"]].map(([action, label]) => <SharedForm key={action} onSubmit={submit} submitLabel={label!} pendingLabel="Updating…" className="min-w-0 space-y-2">
          <input type="hidden" name="host" value={domain.host} /><input type="hidden" name="action" value={action} />
        </SharedForm>)}
      </div>
    </div>)}
  </section>;
}
