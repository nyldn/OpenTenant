import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IdentitySession } from "@opentenant/auth";

const mocks = vi.hoisted(() => ({ navigation: vi.fn(), support: vi.fn() }));
vi.mock("../../lib/tenant", () => ({ currentTenant: async () => ({ tenantId: "tenant_alpha", displayName: "Alpha" }) }));
vi.mock("../../lib/brand", () => ({ brandForTenant: async () => ({ displayName: "Alpha" }) }));
vi.mock("../../lib/session", () => ({ currentSession: async () => null }));
vi.mock("../../lib/module-navigation", () => ({ tenantModuleNavigation: mocks.navigation }));
vi.mock("../../lib/managed-support", () => ({ managedSupportSessionForTenant: mocks.support }));
vi.mock("../../lib/identity-provider", () => ({ usesClerkIdentity: () => false }));
vi.mock("../auth-controls", () => ({ ClerkAuthControls: () => null }));
vi.mock("./application-shell-navigation", () => ({ ApplicationShellFrame: () => null }));
import { ApplicationShell } from "./application-shell";

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.navigation.mockReset().mockResolvedValue({
    navigation: [{ route: "/support", label: "Support" }],
    headerNavigation: [{ id: "help", route: "/support", label: "Get help" }],
  });
  mocks.support.mockReset().mockResolvedValue({ ok: false });
});
afterEach(() => vi.unstubAllGlobals());
const session = (overrides: Partial<IdentitySession> = {}) => ({
  activeTenantId: "tenant_alpha", activeRole: "tenant_member", email: "member@example.test",
  ...overrides,
} as IdentitySession);
async function shell(value: IdentitySession, section?: "settings") {
  const frame = await ApplicationShell({ children: <main>Page</main>, session: value, section });
  if (!React.isValidElement<{ items: Array<{ href: string; label: string }>; header: React.ReactNode }>(frame)) throw new Error("Missing host frame");
  return frame;
}

it("uses authorized registry contributions without adding admin destinations for members", async () => {
  const value = session();
  const frame = await shell(value);
  expect(mocks.navigation).toHaveBeenCalledWith("tenant_alpha", value);
  expect(frame.props.items).toEqual([
    { href: "/", label: "Home" }, { href: "/tenants", label: "Your tenants" }, { href: "/support", label: "Support" },
  ]);
  expect(renderToStaticMarkup(frame.props.header)).toContain('href="/support"');
  expect(renderToStaticMarkup(frame.props.header)).toContain('>Get help</a>');
});

it("requires host tenant membership for settings even for an installation owner", async () => {
  const frame = await shell(session({ activeTenantId: "tenant_beta" as IdentitySession["activeTenantId"], activeRole: "tenant_owner", isPlatformAdmin: true }));
  expect(mocks.navigation).toHaveBeenCalledWith("tenant_alpha", null);
  expect(frame.props.items.some((item: { href: string }) => item.href === "/settings")).toBe(false);
  expect(frame.props.items.some((item: { href: string }) => item.href === "/admin")).toBe(true);
});

it("adds settings destinations only after the settings boundary authorizes the session", async () => {
  const frame = await shell(session({ activeRole: "tenant_owner" }), "settings");
  expect(frame.props.items).toContainEqual({ href: "/settings/activity", label: "Activity" });
  expect(frame.props.items).toContainEqual({ href: "/settings", label: "Settings" });
});
