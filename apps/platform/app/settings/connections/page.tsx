import { SettingsForm, SettingsInput, SettingsNote } from "../_components/settings-form";
import { SettingsAccessDenied, settingsDenialReason } from "../_components/settings-access";
import { connectionStatuses, providerConfig, PROVIDER_SCOPES } from "../../../lib/connections";
import { tenantAdminContext } from "../../../lib/tenant-admin";

export const dynamic = "force-dynamic";

const PROVIDER_LABEL = { google: "Google Workspace", slack: "Slack" } as const;
const PROVIDER_BLURB = {
  google: "Gmail, Drive, and Calendar (read-only) feed the brain's memory with provenance.",
  slack: "Flagged channels and threads become searchable, cited memory.",
} as const;
const STATUS_LABEL: Record<string, string> = {
  not_connected: "Not connected",
  active: "Connected",
  revoked: "Disconnected",
  reauthorization_required: "Needs re-authorization",
};

/**
 * Tenant connections (WP-D.1). Connecting is a browser consent click-through;
 * the platform never asks an admin to paste keys or tokens.
 */
export default async function ConnectionsPage() {
  const gate = await tenantAdminContext("integration.metadata.configure");
  if (!gate.ok) return <SettingsAccessDenied reason={await settingsDenialReason(gate.reason)} />;
  const statuses = await connectionStatuses(gate.context.tenant.tenantId);
  const managedSupport = gate.context.managedSupport !== undefined;

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-xl font-bold">Connections</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect the sources that feed this workspace. Access is read-only, tokens are stored
        encrypted, and every connect and disconnect is recorded in the audit log.
      </p>

      <div className="mt-6 space-y-4">
        {statuses.map((s) => {
          const configured = providerConfig(s.provider) !== null;
          const connected = s.status === "active";
          return (
            <div key={s.provider} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground lg:flex-row lg:items-start lg:justify-between">
              <div className="w-full min-w-0 max-w-4xl break-words">
                <h2 className="text-sm font-semibold">{s.displayName ?? PROVIDER_LABEL[s.provider]}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{PROVIDER_BLURB[s.provider]}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {STATUS_LABEL[s.status]}
                  {connected && s.scopes.length > 0 ? ` · ${s.scopes.length} scope${s.scopes.length === 1 ? "" : "s"}` : ""}
                  {!configured ? " · not configured for this deployment" : ""}
                </p>
                {s.healthNote ? <p className="mt-1 text-xs text-warning-text">{s.healthNote}</p> : null}
                {!connected && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Grants: {PROVIDER_SCOPES[s.provider].map((x) => x.split("/").pop()).join(", ")}
                  </p>
                )}
              </div>
              {!managedSupport && connected ? (
                <form method="POST" action={`/api/settings/connections/${s.provider}/disconnect`}>
                  <button className="min-h-11 shrink-0 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">
                    Disconnect
                  </button>
                </form>
              ) : !managedSupport ? (
                <form method="POST" action={`/api/settings/connections/${s.provider}/start`}>
                  <button
                    disabled={!configured}
                    className="min-h-11 shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed"
                  >
                    Connect
                  </button>
                </form>
              ) : null}
              {connected ? (
                <SettingsForm endpoint="/api/settings/routine-configuration" submitLabel="Save metadata" className="space-y-4 lg:max-w-sm">
                  <input type="hidden" name="area" value="integration_metadata" />
                  <input type="hidden" name="resourceKey" value={s.provider} />
                  <SettingsInput name="displayName" label="Display name" value={s.displayName ?? ""} maxLength={120} />
                  <SettingsNote name="healthNote" label="Health note" value={s.healthNote} />
                </SettingsForm>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
