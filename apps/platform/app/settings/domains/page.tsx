import { SettingsForm, SettingsInput, SettingsNote } from "../_components/settings-form";
import { SettingsAccessDenied, settingsDenialReason } from "../_components/settings-access";
import { tenantAdminContext } from "../../../lib/tenant-admin";
import { tenantDomainSettings } from "../../../lib/tenant-domain-settings";

import { CustomDomainsForm } from "./custom-domains-form";

export const dynamic = "force-dynamic";

/** Tenant-bound domain management; ownership checks precede activation. */
export default async function DomainsSettingsPage() {
  const gate = await tenantAdminContext("domain.metadata.configure");
  if (!gate.ok) return <SettingsAccessDenied reason={await settingsDenialReason(gate.reason)} />;
  const domains = await tenantDomainSettings(gate.context.tenant.tenantId);

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-xl font-bold">Domains</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a subdomain, publish its DNS TXT challenge, then verify ownership to activate it. Sign-in and settings use your platform subdomain.
      </p>
      {!gate.context.managedSupport ? <CustomDomainsForm domains={domains.filter((domain) => domain.kind === "custom")} /> : null}
      <div className="mt-6 space-y-4">
        {domains.length === 0 ? <p className="text-sm text-muted-foreground">No domains configured.</p> : null}
        {domains.map((domain) => (
          <section key={domain.host} className="min-w-0 rounded-lg border border-border bg-card p-4 text-card-foreground">
            <h2 className="break-all font-mono text-sm font-semibold">{domain.host}</h2>
            <p className="text-sm text-muted-foreground">{domain.kind} · {domain.active ? "active" : domain.verification}</p>
            <SettingsForm endpoint="/api/settings/routine-configuration" submitLabel="Save metadata">
              <input type="hidden" name="area" value="domain_metadata" />
              <input type="hidden" name="resourceKey" value={domain.host} />
              <SettingsInput name="displayLabel" label="Display label" value={domain.displayLabel ?? ""} maxLength={120} />
              <SettingsNote name="verificationNote" label="Verification note" value={domain.verificationNote} />
            </SettingsForm>
          </section>
        ))}
      </div>
    </div>
  );
}
