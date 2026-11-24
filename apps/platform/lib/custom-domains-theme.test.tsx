import React from "react";
import RootLayout from "../app/layout";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { tenantBrandStyle } from "./custom-domains-theme";
import { PLATFORM_BRAND_DEFAULTS } from "@opentenant/platform-core";

it("renders distinct tenant tokens as root CSS variables", () => {
  const alpha = renderToStaticMarkup(<html style={tenantBrandStyle({ ...PLATFORM_BRAND_DEFAULTS, colorPrimary: "#123456" })}><body>Alpha</body></html>);
  const beta = renderToStaticMarkup(<html style={tenantBrandStyle({ ...PLATFORM_BRAND_DEFAULTS, colorPrimary: "#abcdef" })}><body>Beta</body></html>);
  expect(alpha).toContain("--primary:#123456");
  expect(beta).toContain("--brand-accent:#abcdef");
  expect(beta).not.toContain("--primary:#abcdef");
});
it("cannot inject CSS declarations, HTML, URLs, or variable names through stored brand values", () => {
  const attack = '</style><script>alert(1)</script>;color:red;background:url(https://example.test)';
  const html = renderToStaticMarkup(<html style={tenantBrandStyle({ ...PLATFORM_BRAND_DEFAULTS, colorPrimary: attack, colorBackground: 'var(--evil)', fontFamilyBody: attack, fontFamilyHeading: 'Inter;--evil:red' })}><body /></html>);
  expect(html).not.toContain("script");
  expect(html).not.toContain("--evil");
  expect(html).not.toContain("url(");
  expect(html).toContain(`--primary:${PLATFORM_BRAND_DEFAULTS.colorPrimary}`);
});

it("the actual root layout applies each resolved tenant policy to every child page", async () => {
  vi.stubGlobal("React", React);
  try {
    layoutMocks.brand.mockResolvedValue({ ...PLATFORM_BRAND_DEFAULTS, colorPrimary: "#123456" });
    const alpha = renderToStaticMarkup(await RootLayout({ children: <main>Any tenant page</main> }));
    layoutMocks.brand.mockResolvedValue({ ...PLATFORM_BRAND_DEFAULTS, colorPrimary: "#abcdef" });
    const beta = renderToStaticMarkup(await RootLayout({ children: <main>Any tenant page</main> }));
    expect(alpha).toContain("--primary:#123456");
    expect(beta).toContain("--brand-accent:#abcdef");
  expect(beta).not.toContain("--primary:#abcdef");
    expect(alpha).toContain("Any tenant page");
  } finally { vi.unstubAllGlobals(); }
});

const layoutMocks = vi.hoisted(() => ({ brand: vi.fn() }));
vi.mock("./brand", () => ({ brandForTenant: layoutMocks.brand }));
vi.mock("./tenant", () => ({ currentTenant: async () => ({ tenantId: "ten_example" }), tenantLifecycleForHost: async () => ({ status: "active" }) }));
vi.mock("./identity-provider", () => ({ usesClerkIdentity: () => false }));

// The root layout now composes an async host shell. This palette test keeps
// its original branding assertions and substitutes only that composition.
vi.mock("./session", () => ({ currentSession: async () => null }));
vi.mock("../app/_components/application-shell", () => ({ ApplicationShell: ({ children }: { children: React.ReactNode }) => children }));
