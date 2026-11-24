import { settingsResult } from "../../../settings/_lib/form-response";
import { installedModules } from "../../../../opentenant-modules";
import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
import { PgAuditStore } from "@opentenant/database";
import { sameOrigin } from "../../../../lib/settings-guard";
import { tenantAdminContext } from "../../../../lib/tenant-admin";
import { controlPlanePool, withControlPlaneTransaction } from "../../../../lib/control-plane";
import { readNavigationOverride, writeNavigationOverride } from "../../../../lib/tenant-settings-store";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";

const EDITABLE_FIELDS = ["label", "order", "visible"] as const;

/** Update presentation-only navigation fields for the installed manifest items. */
export async function POST(req: Request): Promise<Response> {
  const gate = await tenantAdminContext("module.settings.configure");
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const { tenant, auditActor: actor } = gate.context;

  const form = await readBoundedForm(req);
  if (!form) return new Response("bad form", { status: 400 });

  const itemId = String(form.get("itemId") ?? "");
  const item = installedModules.navigation.find((candidate) => candidate.id === itemId);
  if (!item) return new Response("bad item", { status: 400 });

  const row = await readNavigationOverride(tenant.tenantId, itemId);
  const lockedFields = new Set(stringArray(row?.locked_fields));
  const submittedFields = EDITABLE_FIELDS.filter((field) => form.has(field));

  if (submittedFields.some((field) => lockedFields.has(field) || !item.configurable.includes(field === "visible" ? "visibility" : field))) {
    return settingsResult(req, "/settings/navigation?error=locked", { status: "error", message: "This field is locked by platform policy." }, 400);
  }

  const rawLabel = String(form.get("label") ?? "").trim();
  if (form.has("label") && rawLabel.length > 40) {
    return settingsResult(req, "/settings/navigation?error=label", { status: "error", message: "Use a navigation label of up to 40 characters." }, 400);
  }
  const label = rawLabel === "" ? null : rawLabel;

  const rawOrder = String(form.get("order") ?? "");
  const order = Number(rawOrder);
  if (
    form.has("order") &&
    (!/^-?\d+$/.test(rawOrder) || !Number.isInteger(order) || order < -100 || order > 100)
  ) {
    return settingsResult(req, "/settings/navigation?error=order", { status: "error", message: "Enter a whole number from -100 to 100." }, 400);
  }

  const visibleValues = form.getAll("visible").map(String);
  const rawVisible = visibleValues.at(-1);
  if (form.has("visible") && rawVisible !== "true" && rawVisible !== "false") {
    return settingsResult(req, "/settings/navigation?error=visible", { status: "error", message: "Choose whether the navigation item is visible." }, 400);
  }
  const visible = rawVisible === "true";

  const nextLabel = form.has("label") ? label : (row?.label ?? null);
  const nextOrder = form.has("order") ? order : (row?.sort_order ?? null);
  const nextVisible = form.has("visible") ? visible : (row?.visible ?? null);
  const changedFields = submittedFields.filter((field) => {
    if (field === "label") return row?.label !== nextLabel;
    if (field === "order") return row?.sort_order !== nextOrder;
    return row?.visible !== nextVisible;
  });

  if (changedFields.length > 0) {
    try {
      await withControlPlaneTransaction(async (client) => {
        await writeNavigationOverride(client, tenant.tenantId, itemId, {
          label: nextLabel,
          group_name: row?.group_name ?? null,
          sort_order: nextOrder,
          visible: nextVisible,
          locked_fields: stringArray(row?.locked_fields),
        });
        await new PgAuditStore(controlPlanePool()).appendWithClient(client, {
          occurredAt: new Date(),
          actor,
          tenantId: tenant.tenantId,
          action: "navigation.override_changed",
          subject: itemId,
          detail: {
            itemId,
            changedFields: changedFields.join(","),
            supportSessionId: gate.context.managedSupport?.sessionId ?? null,
            supportReason: gate.context.managedSupport?.reason ?? null,
          },
        });
      });
    } catch {
      return settingsResult(req, "/settings/navigation?error=save", { status: "error", message: "Could not save navigation. Try again." }, 500);
    }
  }

  return settingsResult(req, "/settings/navigation", { status: "success", message: changedFields.length ? "Navigation saved." : "Navigation unchanged." });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
