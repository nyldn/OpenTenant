import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  adminTenantOverview: vi.fn(),
  currentSession: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("../../lib/admin-data", () => ({ adminTenantOverview: mocks.adminTenantOverview }));
vi.mock("../../lib/session", () => ({ currentSession: mocks.currentSession }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import AdminPage from "./page";
import { AdminMutationForm } from "./_components/admin-mutation-form";

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join(" ");
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function elements(value: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== "object" || value === null || !("props" in value)) return [];
  const element = value as { type?: unknown; props?: Record<string, unknown> };
  return [element, ...elements(element.props?.children)];
}

beforeEach(() => {
  mocks.currentSession.mockReset().mockResolvedValue({
    isPlatformAdmin: true,
    email: "operator@example.test",
  });
  mocks.adminTenantOverview.mockReset().mockResolvedValue([{
    tenantId: "ten_example",
    slug: "example",
    displayName: "Example Organisation",
    status: "active",
    dataRegion: "us",
    managedSupportEnabled: true,
    domains: [{
      host: "tenant.example.test",
      verification: "verified",
      active: true,
      displayLabel: null,
      verificationNote: null,
    }],
    modules: [],
    brandKey: null,
  }]);
});

it("exposes visible policy controls and a tenant-host support entry path", async () => {
  const result = await AdminPage();
  const tree = elements(result);

  expect(textContent(result)).toContain("Enabled for routine configuration");
  expect(tree.some((element) => element.type === AdminMutationForm
    && element.props?.action === "/api/admin/support-policy")).toBe(true);
  expect(tree.some((element) => element.type === "a"
    && element.props?.href === "https://tenant.example.test/admin/support")).toBe(true);
  expect(tree.some((element) => element.props?.href === "/admin/tenants/ten_example/brand-proposals")).toBe(true);
});

it("does not offer a dead support entry path for an inactive domain", async () => {
  const tenant = (await mocks.adminTenantOverview())[0];
  mocks.adminTenantOverview.mockResolvedValueOnce([{
    ...tenant,
    domains: [{ ...tenant.domains[0], active: false, verification: "pending" }],
  }]);

  const result = await AdminPage();

  expect(elements(result).some((element) => element.type === "a"
    && String(element.props?.href).endsWith("/admin/support"))).toBe(false);
});


it("denies non-admin access before loading the installation tenant overview", async () => {
  mocks.currentSession.mockResolvedValue({ isPlatformAdmin: false });
  const result = await AdminPage();
  expect(result.type.name).toBe("AdminAccessDenied");
  expect(mocks.adminTenantOverview).not.toHaveBeenCalled();
});
