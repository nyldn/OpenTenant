import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  brandForTenant: vi.fn(),
  tenantAdminContext: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("../../lib/brand", () => ({ brandForTenant: mocks.brandForTenant }));
vi.mock("../../lib/tenant-admin", () => ({ tenantAdminContext: mocks.tenantAdminContext }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import SettingsLayout from "./layout";

function elements(value: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== "object" || value === null || !("props" in value)) return [];
  const element = value as { type?: unknown; props?: Record<string, unknown> };
  return [element, ...elements(element.props?.children)];
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenantAdminContext.mockResolvedValue({
    ok: true,
    context: {
      tenant: { tenantId: "ten_example", displayName: "Example Organisation" },
      session: { email: "admin@example.test" },
    },
  });
  mocks.brandForTenant.mockResolvedValue({ displayName: "Example Organisation", logoUrl: null });
});

it("composes the settings shell with the authorized session and page body", async () => {
  const child = React.createElement("p", null, "Child");
  const result = await SettingsLayout({ children: child });
  expect(result.props.section).toBe("settings");
  expect(result.props.session).toEqual({ email: "admin@example.test" });
  expect(elements(result).some(element => element.props?.children === "Child")).toBe(true);
});

it.each([
  ["anonymous", "/auth/login?return=/settings"],
  ["forbidden", "/"],
  ["no_tenant", "/"],
])("keeps the shared settings boundary for %s sessions", async (reason, destination) => {
  mocks.tenantAdminContext.mockResolvedValueOnce({ ok: false, reason });

  await expect(SettingsLayout({ children: null })).rejects.toThrow(`NEXT_REDIRECT:${destination}`);
  expect(mocks.brandForTenant).not.toHaveBeenCalled();
});
