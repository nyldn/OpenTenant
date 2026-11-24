import { tenantBrandingAssets } from "../../../lib/tenant-branding-assets";
import { SettingsForm, SettingsInput, SettingsSelect } from "../_components/settings-form";
import { SettingsAccessDenied, settingsDenialReason } from "../_components/settings-access";
import { PLATFORM_BRAND_DEFAULTS } from "../../../lib/brand";
import Link from "next/link";
import type { TenantId } from "@opentenant/auth";
import { brandProposalEntry, tenantAdminContext } from "../../../lib/tenant-admin";
import { readBrandPolicy } from "../../../lib/tenant-settings-store";

export const dynamic = "force-dynamic";

const EDITABLE_KEYS = ["displayName", "logoUrl", "exportFilenameSuffix"] as const;

/** Tenant brand overrides within the keys allowed by the settings surface. */
export default async function BrandingSettingsPage() {
  const gate = await tenantAdminContext("branding.configure");
  if (!gate.ok) return <SettingsAccessDenied reason={await settingsDenialReason(gate.reason)} />;
  const { tenant, session } = gate.context;
  const proposals = brandProposalEntry(session, tenant.tenantId as TenantId);

  const row = await readBrandPolicy(tenant.tenantId);
  const lockedKeys = stringArray(row?.locked_keys);
  const locked = new Set(lockedKeys);
  const overrides = asRecord(row?.overrides);
  const merged: Record<string, unknown> = {
    ...PLATFORM_BRAND_DEFAULTS,
    ...asRecord(row?.defaults),
  };
  for (const key of EDITABLE_KEYS) {
    if (!locked.has(key) && Object.hasOwn(overrides, key)) merged[key] = overrides[key];
  }

  const displayName =
    typeof merged.displayName === "string" ? merged.displayName : PLATFORM_BRAND_DEFAULTS.displayName;
  const assets = await tenantBrandingAssets(tenant.tenantId);
  const logoUrl = assets.some(asset => asset.url === merged.logoUrl) ? String(merged.logoUrl) : "";
  const exportFilenameSuffix =
    typeof merged.exportFilenameSuffix === "string" &&
    /^[a-z0-9-]{0,20}$/.test(merged.exportFilenameSuffix)
      ? merged.exportFilenameSuffix
      : "";
  const editableLockedKeys = EDITABLE_KEYS.filter((key) => locked.has(key));

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-xl font-bold">Branding</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Brand settings for {tenant.displayName}. Platform policy controls locked fields.
      </p>
      {proposals ? (
        <p className="mt-3 text-sm">
          <Link href={proposals.href} className="font-medium text-primary-text underline underline-offset-4">
            {proposals.label}
          </Link>
          <span className="text-muted-foreground"> to upload a brand.md, review it and apply it.</span>
        </p>
      ) : null}

      <section className="mt-6 rounded-lg border border-border bg-card text-card-foreground p-4 sm:p-5">
        <h2 className="font-display text-lg font-semibold">Tenant brand</h2>
        {editableLockedKeys.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Locked fields: {editableLockedKeys.join(", ")}
          </p>
        ) : null}

        <SettingsForm endpoint="/api/settings/branding" submitLabel="Save branding">
          <SettingsInput name="displayName" label="Display name" value={displayName} required={!locked.has("displayName")} maxLength={60} disabled={locked.has("displayName")} help={locked.has("displayName") ? "Locked by platform policy." : undefined} />
          <SettingsSelect name="logoUrl" label="Logo" value={logoUrl} disabled={locked.has("logoUrl")}>
            <option value="">None</option>
            {assets.map(asset => <option key={asset.url} value={asset.url}>{asset.displayName}</option>)}
          </SettingsSelect>
          <SettingsInput name="exportFilenameSuffix" label="Export filename suffix" value={exportFilenameSuffix} maxLength={20} pattern="[a-z0-9-]{0,20}" disabled={locked.has("exportFilenameSuffix")} help={locked.has("exportFilenameSuffix") ? "Locked by platform policy." : "Lowercase letters, numbers and hyphens, up to 20 characters."} />
        </SettingsForm>
      </section>
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
