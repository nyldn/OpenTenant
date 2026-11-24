import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
import { PgAuditStore } from "@opentenant/database";
import { sameOrigin } from "../../../../lib/settings-guard";
import { tenantAdminContext } from "../../../../lib/tenant-admin";
import { controlPlanePool, withControlPlaneTransaction } from "../../../../lib/control-plane";
import { writeBrandOverrides } from "../../../../lib/tenant-settings-store";
import { tenantOwnsBrandingAsset } from "../../../../lib/tenant-branding-assets";
import { readBoundedForm } from "../../../../lib/bounded-body";
import { settingsResult } from "../../../settings/_lib/form-response";
import { lockBrandPolicy } from "../../../settings/_lib/settings-store";
export const runtime = "nodejs";
const EDITABLE_KEYS = ["displayName", "logoUrl", "exportFilenameSuffix"] as const;

export async function POST(req: Request): Promise<Response> {
  const gate = await tenantAdminContext("branding.configure");
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const form = await readBoundedForm(req);
  if (!form) return new Response("bad form", { status: 400 });
  const error = (message: string, key: string, status = 400) => settingsResult(req, `/settings/branding?error=${key}`, { status: "error", message }, status);
  const displayName = String(form.get("displayName") ?? "").trim();
  if (form.has("displayName") && (displayName.length < 1 || displayName.length > 60)) return error("Enter a display name of 1 to 60 characters.", "displayName");
  const logoUrl = String(form.get("logoUrl") ?? "");
  const suffix = String(form.get("exportFilenameSuffix") ?? "");
  if (form.has("exportFilenameSuffix") && !/^[a-z0-9-]{0,20}$/.test(suffix)) return error("Use up to 20 lowercase letters, numbers or hyphens for the export suffix.", "exportFilenameSuffix");
  const { tenant, auditActor: actor } = gate.context;
  try {
    const result = await withControlPlaneTransaction(async client => {
      const row = await lockBrandPolicy(client, tenant.tenantId);
      const locked = new Set(Array.isArray(row?.locked_keys) ? row.locked_keys : []);
      const submitted = EDITABLE_KEYS.filter(key => form.has(key));
      if (submitted.some(key => locked.has(key))) return { error: "This field is locked by platform policy.", key: "locked" };
      if (form.has("logoUrl") && !await tenantOwnsBrandingAsset(tenant.tenantId, logoUrl, client)) return { error: "Choose one of this tenant's logos or a public platform default.", key: "logoUrl" };
      const current = asRecord(row?.overrides);
      const next = { ...current };
      if (form.has("displayName")) next.displayName = displayName;
      if (form.has("logoUrl")) next.logoUrl = logoUrl || null;
      if (form.has("exportFilenameSuffix")) { if (suffix) next.exportFilenameSuffix = suffix; else delete next.exportFilenameSuffix; }
      const changedKeys = submitted.filter(key => Object.hasOwn(current, key) !== Object.hasOwn(next, key) || !Object.is(current[key], next[key]));
      if (changedKeys.length) {
        await writeBrandOverrides(client, tenant.tenantId, next);
        await new PgAuditStore(controlPlanePool()).appendWithClient(client, {
          occurredAt: new Date(), actor, tenantId: tenant.tenantId, action: "brand.overrides_changed", subject: tenant.tenantId,
          detail: { changedKeys: changedKeys.join(","), supportSessionId: gate.context.managedSupport?.sessionId ?? null, supportReason: gate.context.managedSupport?.reason ?? null },
        });
      }
      return { changed: changedKeys.length > 0 };
    });
    if (result.error) return error(result.error, result.key!);
    return settingsResult(req, "/settings/branding", { status: "success", message: result.changed ? "Branding saved." : "Branding unchanged." });
  } catch { return error("Could not save branding. Try again.", "save", 500); }
}
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
