vi.mock("../../opentenant-modules", () => ({ installedModules: { get: () => ({ permissions: { passcode: ["sample.use"] } }), route: () => ({ module: { manifest: { key: "sample" } } }) } }));
import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  cookies: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(destination === "NEXT_NOT_FOUND" ? destination : `NEXT_REDIRECT:${destination}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("../../lib/module-access-gate", () => ({ resolveModuleAccess: mocks.access }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import AssessmentLayout from "./page";
vi.mock("../../lib/module-services", () => ({ moduleServicesFor: () => ({}) }));
vi.mock("../../lib/module-registry", () => ({ nativeModuleEnabled: async () => true }));
vi.mock("../../lib/module-access", () => ({ accessCookieName: () => "module-access", resolvePermissions: async () => [] }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({
    get: vi.fn(() => ({ value: "signed-grant" })),
  });
  mocks.access.mockResolvedValue({
    ok: true,
    tenantId: "ten_sample",
    mode: "identity",
    principal: {
      kind: "identity",
      principalId: "usr_member",
      session: { activeTenantId: "ten_sample" },
    },
  });
});

it.each([
  ["no_tenant", "NEXT_NOT_FOUND"],
  ["anonymous", "/auth/login?return=%2Fsample"],
  ["forbidden", "NEXT_NOT_FOUND"],
  ["passcode_required", "/access/sample"],
])("keeps the existing redirect for %s denials", async (reason, destination) => {
  mocks.access.mockResolvedValueOnce({ ok: false, reason });

  await expect(AssessmentLayout({ params: Promise.resolve({ modulePath: ["sample"] }) })).rejects.toThrow(
    destination === "NEXT_NOT_FOUND" ? destination : `NEXT_REDIRECT:${destination}`,
  );
});

it("uses the existing 404 UI when Assessment is unavailable", async () => {
  mocks.access.mockResolvedValueOnce({
    ok: false,
    reason: "unavailable",
    tenantId: "ten_sample",
  });

  await expect(AssessmentLayout({ params: Promise.resolve({ modulePath: ["sample"] }) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
});
