import { describe, expect, it } from "vitest";
import { BRAIN_MANIFEST } from "./manifest";
import { BrainSurface } from "./BrainSurface";

describe("BRAIN_MANIFEST", () => {
  it("declares the native brain module contract", () => {
    expect(BRAIN_MANIFEST).toMatchObject({
      key: BRAIN_MODULE.manifest.key,
      runtime: "native",
      permissions: ["brain.use", "brain.promote", "brain.admin"],
    });
    expect(BRAIN_MANIFEST.navigation).toEqual([
      expect.objectContaining({
        id: "brain.workspace",
        route: "/brain",
        requiredPermission: "brain.use",
      }),
    ]);
  });
});

import { isValidElement } from "react";
import { BRAIN_MODULE } from "./manifest";
import type { ModulePageContext } from "@opentenant/module-sdk";
const pageContext = (services?: unknown): ModulePageContext => ({
  tenantId: "tenant_example", userId: "user_example", permissions: new Set(["brain.use"]), services,
});
it("renders BrainSurface through the active manifest route", async () => {
  const view = await BRAIN_MODULE.routes[0]!.render!(pageContext());
  expect(isValidElement(view)).toBe(true);
  expect(view).toMatchObject({ type: BrainSurface, props: { apiPath: BRAIN_MODULE.apiRoutes[0]!.path, availability: { state: "unavailable" } } });
});
it("distinguishes the configured API from browser authorization", async () => {
  const view = await BRAIN_MODULE.routes[0]!.render!(pageContext({ serverConfig: () => ({ MODULE_SIGNING_PUBLIC_KEY: "configured" }) }));
  expect(view).toMatchObject({ props: { availability: { state: "api-only" } } });
});
it("uses the host's confirmed local search capability without acquiring signing keys", async () => {
  const availability = { state: "local", contextToken: "scoped-context" };
  const context = pageContext({ brainBrowserAvailability: async (bound: ModulePageContext) => {
    expect(bound.tenantId).toBe("tenant_example"); expect(bound.userId).toBe("user_example"); return availability;
  } });
  expect(await BRAIN_MODULE.routes[0]!.render!(context)).toMatchObject({ props: { availability } });
  expect(BRAIN_MODULE.environmentKeys).not.toContain("MODULE_SIGNING_PRIVATE_KEY");
});
it("fails closed when browser composition fails", async () => {
  expect(await BRAIN_MODULE.routes[0]!.render!(pageContext({ brainBrowserAvailability: async () => { throw new Error("private configuration"); } })))
    .toMatchObject({ props: { availability: { state: "unavailable" } } });
});
it("never asks for browser authority without brain.use", async () => {
  const context = pageContext({ brainBrowserAvailability: async () => { throw new Error("must not run"); } });
  context.permissions = new Set();
  expect(await BRAIN_MODULE.routes[0]!.render!(context)).toMatchObject({ props: { availability: { state: "denied" } } });
});
