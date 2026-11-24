import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn(),
  tenantLauncher: vi.fn(),
  redirect: vi.fn((destination: string) => { throw new Error(`NEXT_REDIRECT:${destination}`); }),
}));

vi.mock("../../lib/session", () => ({ currentSession: mocks.currentSession }));
vi.mock("../../lib/tenant-launcher", () => ({ tenantLauncher: mocks.tenantLauncher }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({ default: "a" }));

import TenantsPage from "./page";

function elements(value: unknown): Array<{ type?: unknown; props?: Record<string, unknown> }> {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== "object" || value === null || !("props" in value)) return [];
  const element = value as { type?: unknown; props?: Record<string, unknown> };
  return [element, ...elements(element.props?.children)];
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return elements(value).map((element) => element.props?.children).flat().filter((v) => typeof v === "string").join(" ");
}

beforeEach(() => {
  mocks.currentSession.mockReset().mockResolvedValue({ userId: "user_example" });
  mocks.tenantLauncher.mockReset().mockResolvedValue([
    { tenantId: "tenant_a", displayName: "Alpha", role: "tenant_admin", availability: "available", launchUrl: "https://alpha.example.test" },
    { tenantId: "tenant_b", displayName: "Beta", role: "tenant_member", availability: "unavailable" },
  ]);
  mocks.redirect.mockClear();
});

it("requires a valid current session", async () => {
  mocks.currentSession.mockResolvedValueOnce(null);
  await expect(TenantsPage()).rejects.toThrow("NEXT_REDIRECT:/auth/login?return=/tenants");
  expect(mocks.tenantLauncher).not.toHaveBeenCalled();
});

it("renders an accessible tenant list with roles, unavailable state, and direct host links", async () => {
  const result = await TenantsPage();
  const tree = elements(result);
  const link = tree.find((element) => element.type === "a" && element.props?.href === "https://alpha.example.test");

  expect(tree.some((element) => element.type === "main")).toBe(true);
  expect(tree.some((element) => element.type === "h1")).toBe(true);
  expect(tree.some((element) => element.type === "ul")).toBe(true);
  expect(tree.filter((element) => element.type === "li")).toHaveLength(2);
  expect(link).toBeDefined();
  expect(link?.props?.href).toBe("https://alpha.example.test");
  expect(link?.props).not.toHaveProperty("target");
  expect(text(link)).toMatch(/open tenant/i);
  expect(text(result)).toMatch(/tenant admin/i);
  expect(text(result)).toMatch(/unavailable/i);
});

it("renders an empty membership state", async () => {
  mocks.tenantLauncher.mockResolvedValueOnce([]);
  const tree = elements(await TenantsPage());
  const state = tree.find(element => element.props?.state === "empty");
  expect(state?.props?.description).toMatch(/no tenant memberships/i);
  expect(state?.props?.description).toMatch(/invitation link/i);
  expect(tree.some(element => typeof element.type === "function" && element.type.name === "SignOutAction")).toBe(true);
});
