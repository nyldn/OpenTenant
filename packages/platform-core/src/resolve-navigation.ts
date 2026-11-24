/**
 * Tenant navigation resolution (spec 10.2).
 *
 * Overrides may only touch fields the module manifest marks configurable and
 * platform policy has not locked. Navigation output is presentation only: it
 * can never grant entitlement, create a route, or weaken a permission, and a
 * hidden item's server-side checks still apply.
 */
import type { ModuleNavigationItem } from "@opentenant/module-sdk";
import type { NavigationOverride } from "./modules";

export interface ResolvedNavigationItem {
  id: string;
  label: string;
  route: string;
  group: string | null;
  order: number;
  visible: boolean;
  requiredPermission: string;
}

export interface NavigationResolution {
  items: ResolvedNavigationItem[];
  /** Overrides referencing unknown or stale manifest item IDs (spec: fail validation, no entry). */
  invalidOverrideItemIds: string[];
  /** Override fields dropped because the manifest does not mark them configurable or policy locks them. */
  rejectedFields: Array<{ itemId: string; field: string }>;
}

export function resolveNavigation(
  manifestItems: ReadonlyArray<ModuleNavigationItem>,
  overrides: ReadonlyArray<NavigationOverride>,
  /** Permissions held by the current user; items they cannot access are suppressed. */
  grantedPermissions: ReadonlySet<string>,
): NavigationResolution {
  const byId = new Map(manifestItems.map((item) => [item.id, item]));
  const invalidOverrideItemIds: string[] = [];
  const rejectedFields: Array<{ itemId: string; field: string }> = [];
  const overrideById = new Map<string, NavigationOverride>();

  for (const override of overrides) {
    if (!byId.has(override.itemId) || overrideById.has(override.itemId)) {
      // Unknown, stale, or duplicate IDs fail validation and produce nothing.
      invalidOverrideItemIds.push(override.itemId);
      continue;
    }
    overrideById.set(override.itemId, override);
  }

  const items: ResolvedNavigationItem[] = [];
  for (const [index, item] of manifestItems.entries()) {
    // Server-side authorization is the real control; navigation only reflects it.
    if (!grantedPermissions.has(item.requiredPermission)) continue;

    const override = overrideById.get(item.id);
    const configurable = new Set<string>(item.configurable);
    const locked = new Set<string>(override?.lockedFields ?? []);

    const take = <T>(field: "label" | "group" | "order" | "visibility", value: T | undefined, fallback: T): T => {
      if (value === undefined) return fallback;
      if (!configurable.has(field) || locked.has(mapLockField(field))) {
        rejectedFields.push({ itemId: item.id, field });
        return fallback;
      }
      return value;
    };

    const visible = take("visibility", override?.visible, true);
    if (!visible) continue;

    items.push({
      id: item.id,
      label: take("label", override?.label, item.defaultLabel),
      route: item.route,
      group: take("group", override?.group, null),
      order: take("order", override?.order, index),
      visible: true,
      requiredPermission: item.requiredPermission,
    });
  }

  items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { items, invalidOverrideItemIds, rejectedFields };
}

/** Manifest speaks "visibility"; stored override locks speak "visible". */
function mapLockField(field: "label" | "group" | "order" | "visibility"): string {
  return field === "visibility" ? "visible" : field;
}
