import { NavigationForm } from "./navigation-form";
import { SettingsAccessDenied, settingsDenialReason } from "../_components/settings-access";
import { installedModules } from "../../../opentenant-modules";
import { tenantAdminContext } from "../../../lib/tenant-admin";
import { readNavigationOverride } from "../../../lib/tenant-settings-store";

export const dynamic = "force-dynamic";


/** Navigation overrides for the configurable installed module items. */
export default async function NavigationSettingsPage() {
  const gate = await tenantAdminContext("module.settings.configure");
  if (!gate.ok) return <SettingsAccessDenied reason={await settingsDenialReason(gate.reason)} />;
  const { tenant } = gate.context;
  const entries = await Promise.all(installedModules.navigation.map(async (item) => {
  const row = await readNavigationOverride(tenant.tenantId, item.id);
  const lockedFields = stringArray(row?.locked_fields);
  const locked = new Set(lockedFields);
  const editableLockedFields = ["label", "order", "visible"].filter((field) => locked.has(field));

    return { item, row, locked, editableLockedFields };
  }));

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-xl font-bold">Navigation</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Control how module links appear for {tenant.displayName}.
      </p>

      {entries.map(({ item, row, locked, editableLockedFields }) => (<section key={item.id} className="mt-6 rounded-lg border border-border bg-card text-card-foreground p-4 sm:p-5">
        <h2 className="font-display text-lg font-semibold">{item.defaultLabel}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Item ID: <span className="font-mono">{item.id}</span>
        </p>
        {editableLockedFields.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Locked fields: {editableLockedFields.join(", ")}
          </p>
        ) : null}

        <NavigationForm itemId={item.id} label={row?.label ?? ""} order={row?.sort_order ?? 0} visible={row?.visible ?? true} locked={[...locked, ...["label", "order", "visible"].filter(field => !item.configurable.includes(field === "visible" ? "visibility" : field as "label" | "order"))]} />
      </section>))}
    </div>
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
