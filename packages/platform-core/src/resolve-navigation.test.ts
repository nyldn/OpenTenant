import { describe, expect, it } from "vitest";
import type { TenantId } from "@opentenant/auth";
import type { ModuleNavigationItem } from "@opentenant/module-sdk";
import type { NavigationOverride } from "./modules";
import { resolveNavigation } from "./resolve-navigation";

const tenantId = "tenant_navigation_tests" as TenantId;

function manifestItem(
  id: string,
  configurable: ModuleNavigationItem["configurable"] = [],
  requiredPermission = "navigation:view",
  defaultLabel = `Default ${id}`,
): ModuleNavigationItem {
  return {
    id,
    defaultLabel,
    route: `/${id}`,
    configurable,
    requiredPermission,
  };
}

interface OverrideValues {
  label?: string;
  group?: string;
  order?: number;
  visible?: boolean;
  lockedFields?: NavigationOverride["lockedFields"];
}

function navigationOverride(itemId: string, values: OverrideValues = {}): NavigationOverride {
  const { lockedFields = [], ...fields } = values;
  return {
    tenantId,
    itemId,
    lockedFields,
    version: 1,
    ...fields,
  };
}

describe("resolveNavigation", () => {
  it("suppresses an item without its required permission even when an override makes it visible", () => {
    const item = manifestItem("admin", ["visibility"], "admin:view");
    const override = navigationOverride("admin", { visible: true });

    const result = resolveNavigation([item], [override], new Set());

    expect(result.items).toEqual([]);
  });

  it("applies a label override only when label is configurable", () => {
    const configurable = manifestItem("configurable", ["label"]);
    const fixed = manifestItem("fixed", [], "navigation:view", "Fixed Default");

    const result = resolveNavigation(
      [configurable, fixed],
      [
        navigationOverride("configurable", { label: "Configured Label" }),
        navigationOverride("fixed", { label: "Rejected Label" }),
      ],
      new Set(["navigation:view"]),
    );

    expect(result.items.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "configurable", label: "Configured Label" },
      { id: "fixed", label: "Fixed Default" },
    ]);
    expect(result.rejectedFields).toEqual([{ itemId: "fixed", field: "label" }]);
  });

  it("rejects a locked visibility override and keeps the default visibility", () => {
    const item = manifestItem("reports", ["visibility"]);
    const override = navigationOverride("reports", {
      visible: false,
      lockedFields: ["visible"],
    });

    const result = resolveNavigation([item], [override], new Set(["navigation:view"]));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.visible).toBe(true);
    expect(result.rejectedFields).toEqual([{ itemId: "reports", field: "visibility" }]);
  });

  it("marks an unknown override itemId invalid and produces no item for it", () => {
    const result = resolveNavigation(
      [],
      [navigationOverride("unknown")],
      new Set(["navigation:view"]),
    );

    expect(result.items).toEqual([]);
    expect(result.invalidOverrideItemIds).toEqual(["unknown"]);
  });

  it("marks the second override for the same itemId invalid", () => {
    const item = manifestItem("home", ["label"]);

    const result = resolveNavigation(
      [item],
      [
        navigationOverride("home", { label: "First Label" }),
        navigationOverride("home", { label: "Second Label" }),
      ],
      new Set(["navigation:view"]),
    );

    expect(result.items[0]?.label).toBe("First Label");
    expect(result.invalidOverrideItemIds).toEqual(["home"]);
  });

  it("hides an otherwise permitted item when visibility is overridden to false", () => {
    const item = manifestItem("billing", ["visibility"]);
    const override = navigationOverride("billing", { visible: false });

    const result = resolveNavigation([item], [override], new Set(["navigation:view"]));

    expect(result.items).toEqual([]);
    expect(result.rejectedFields).toEqual([]);
  });

  it("applies explicit order overrides and breaks order ties by id", () => {
    const items = [
      manifestItem("zeta", ["order"]),
      manifestItem("beta", ["order"]),
      manifestItem("alpha", ["order"]),
    ];
    const overrides = [
      navigationOverride("zeta", { order: 10 }),
      navigationOverride("beta", { order: 5 }),
      navigationOverride("alpha", { order: 5 }),
    ];

    const result = resolveNavigation(items, overrides, new Set(["navigation:view"]));

    expect(result.items.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: "alpha", order: 5 },
      { id: "beta", order: 5 },
      { id: "zeta", order: 10 },
    ]);
  });
});
