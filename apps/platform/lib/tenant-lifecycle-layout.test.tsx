import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const h = vi.hoisted(() => ({ tenant: vi.fn(), lifecycle: vi.fn(), brand: vi.fn() }));
vi.mock("./session", () => ({ currentSession: async () => null }));
vi.mock("../app/_components/application-shell", () => ({ ApplicationShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./tenant", () => ({ currentTenant: h.tenant, tenantLifecycleForHost: h.lifecycle }));
vi.mock("./brand", () => ({ brandForTenant: h.brand }));
vi.mock("./identity-provider", () => ({ usesClerkIdentity: () => false }));
vi.mock("./clerk-browser-config", () => ({ clerkBrowserPublishableKey: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ ClerkProvider: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
import RootLayout from "../app/layout";
describe("tenant lifecycle layout", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("replaces tenant children and branding with the suspended page", async () => {
    vi.stubGlobal("React", React);
    h.tenant.mockResolvedValue(null); h.lifecycle.mockResolvedValue({ status: "suspended" });
    const html = renderToStaticMarkup(await RootLayout({ children: <p>private tenant content</p> }));
    expect(html).toContain("Tenant suspended");
    expect(html).not.toContain("private tenant content");
    expect(h.brand).not.toHaveBeenCalled();
  });
  it("restores children after the tenant resumes", async () => {
    vi.stubGlobal("React", React);
    h.tenant.mockResolvedValue({ tenantId: "tenant_example", status: "active" }); h.lifecycle.mockResolvedValue({ status: "active" });
    h.brand.mockResolvedValue({ cssBrandKey: "opentenant" });
    const html = renderToStaticMarkup(await RootLayout({ children: <p>tenant content</p> }));
    expect(html).toContain("tenant content");
    expect(html).not.toContain("Tenant suspended");
  });
});
