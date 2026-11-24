import { SettingsForm, SettingsInput, SettingsNote } from "../_components/settings-form";
import { SettingsAccessDenied, settingsDenialReason } from "../_components/settings-access";
import { nativeModuleEnabled } from "../../../lib/module-registry";
import type { TenantId } from "@opentenant/auth";
import { installedModules } from "../../../opentenant-modules";
import { resolvePermissions } from "../../../lib/module-access";
import { currentSession } from "../../../lib/session";
import { renderModuleView } from "../../../lib/module-view";
import { moduleAccessPolicy, tenantModulePresentation } from "../../../lib/module-access";
import { tenantAdminContext } from "../../../lib/tenant-admin";

export const dynamic = "force-dynamic";

/** Module access configuration for this tenant (identity vs passcode). */
export default async function ModulesSettingsPage() {
  const gate = await tenantAdminContext("module.settings.configure");
  if (!gate.ok) return <SettingsAccessDenied reason={await settingsDenialReason(gate.reason)} />;
  const { tenant } = gate.context;
  const session = await currentSession(tenant.tenantId as TenantId);
  const entries = await Promise.all(installedModules.modules.map(async (module) => {
    const key = module.manifest.key;
    const [policy, presentation, permissions] = await Promise.all([
      moduleAccessPolicy(tenant.tenantId, key), tenantModulePresentation(tenant.tenantId, key),
      session ? resolvePermissions(session, tenant.tenantId, key) : Promise.resolve([]),
    ]);
    const context = { tenantId: tenant.tenantId, userId: session?.userId ?? "", permissions: new Set(permissions) };
    const entitled = await nativeModuleEnabled(tenant.tenantId, key);
    const panels = await Promise.all([...module.settingsPanels, ...module.adminPages].filter((panel) => entitled && context.permissions.has(panel.requiredPermission))
      .map(async (panel) => ({ id: panel.id, view: await panel.render(context) })));
    return { module, policy, presentation, panels };
  }));
  const managedSupport = gate.context.managedSupport !== undefined;

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-xl font-bold">Modules</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How people access each module on {tenant.displayName}.
      </p>

      {entries.map(({ module, policy, presentation, panels }) => (<section key={module.manifest.key} className="mt-6 rounded-lg border border-border bg-card text-card-foreground p-4 sm:p-5">
        <h2 className="font-display text-lg font-semibold">{module.catalog.displayName}</h2>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{module.manifest.key}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Current access: <span className="font-mono">{policy.mode}</span>
          {presentation ? ` · ${presentation.enabled ? "enabled" : "disabled"}` : ""}
        </p>

        <SettingsForm endpoint="/api/settings/routine-configuration" submitLabel="Save presentation settings">
          <input type="hidden" name="area" value="module_metadata" />
          <input type="hidden" name="resourceKey" value={module.manifest.key} />
          <SettingsInput name="displayLabel" label="Display label" value={presentation?.displayLabel ?? ""} maxLength={120} />
          <SettingsNote name="supportNote" label="Support note" value={presentation?.supportNote} />
        </SettingsForm>

        {managedSupport ? (
          <p className="mt-5 rounded-md border border-warning-text bg-warning p-3 text-sm text-warning-foreground">
            Access mode and passcode changes require separate sensitive authority and are unavailable in routine support.
          </p>
        ) : (
        <SettingsForm endpoint="/api/settings/module-access" fallbackPath="/settings/modules" submitLabel="Save access mode" className="mt-5 space-y-4 border-t border-border pt-4">
          <input type="hidden" name="moduleKey" value={module.manifest.key} />
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" value="identity" defaultChecked={policy.mode === "identity"} />
              <span>
                <span className="font-medium">Sign-in required</span>
                <span className="block text-xs text-muted-foreground">
                  Members sign in with their account (or company SSO when enabled).
                </span>
              </span>
            </label>
            {module.permissions.passcode?.length ? <label className="flex items-start gap-2">
              <input type="radio" name="mode" value="passcode" defaultChecked={policy.mode === "passcode"} />
              <span>
                <span className="font-medium">Access code</span>
                <span className="block text-xs text-muted-foreground">
                  Anyone with the shared code can use the module. Set a new code below when
                  choosing this mode.
                </span>
              </span>
            </label> : null}
          </div>
          <SettingsInput name="passcode" label="New access code" type="password" help="At least 8 characters, required when switching to or rotating a code." />
        </SettingsForm>
        )}
        {panels.map((panel) => <div key={panel.id}>{renderModuleView(panel.view)}</div>)}
      </section>))}
    </div>
  );
}
