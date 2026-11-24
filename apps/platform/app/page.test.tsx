import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn().mockResolvedValue(null),
  currentTenant: vi.fn(),
  support: vi.fn(),
  navigation: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("../lib/session", () => ({ currentSession: mocks.currentSession }));
vi.mock("../lib/managed-support", () => ({ managedSupportSessionForTenant: mocks.support }));
vi.mock("../lib/module-navigation", () => ({ tenantModuleNavigation: mocks.navigation }));
vi.mock("../lib/identity-provider", () => ({ usesClerkIdentity: () => false }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../lib/tenant", () => ({ currentTenant: mocks.currentTenant }));
vi.mock("../lib/brand", () => ({
  brandForTenant: vi.fn().mockResolvedValue({
    displayName: "Home Tenant",
    logoUrl: null,
    coBrandingRequired: false,
  }),
}));
vi.mock("../lib/module-access", () => ({
  resolvePermissions: async () => ["sample.use"],
  moduleAccessPolicy: vi.fn().mockResolvedValue({ mode: "identity" }),
}));

import Home from "./page";

beforeEach(() => {
  mocks.currentSession.mockReset().mockResolvedValue(null);
  mocks.support.mockReset().mockResolvedValue({ ok: false });
  mocks.navigation.mockReset().mockResolvedValue({ navigation: [], passcodeModules: [] });
  mocks.currentTenant.mockReset().mockResolvedValue({
    tenantId: "tenant_home",
    displayName: "Home Tenant",
  });
  mocks.notFound.mockClear();
});

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join(" ");
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

it("binds the home session to the resolved tenant before showing workspace access", async () => {
  const result = await Home();

  expect(mocks.currentSession).toHaveBeenCalledWith("tenant_home");
  expect(textContent(result)).toContain("Sign in to your workspace.");
});

it("uses the generic not-found boundary when the host has no tenant", async () => {
  mocks.currentTenant.mockResolvedValue(null);

  await expect(Home()).rejects.toThrow("NEXT_NOT_FOUND");

  expect(mocks.notFound).toHaveBeenCalledOnce();
  expect(mocks.currentSession).not.toHaveBeenCalled();
});

it("keeps a verified support operator in the host shell without granting tenant module navigation", async () => {
  const operator = { email: "operator@example.test", activeTenantId: null, isPlatformAdmin: true };
  mocks.support.mockResolvedValue({ ok: true, context: { operator } });
  const result = await Home();
  expect(result.props.session).toBe(operator);
  expect(mocks.support).toHaveBeenCalledWith("tenant_home");
  expect(mocks.navigation).toHaveBeenCalledWith("tenant_home", null);
});
