import { expect, tenantTest as test, tenantOrigin } from "./fixtures";

test("every tenant route inherits its tenant's applied tokens", async ({ page }) => {
  for (const path of ["/", "/settings/domains", "/support"]) {
    const palettes: string[] = [];
    for (const tenant of ["alpha", "beta"]) {
      expect((await page.goto(`${tenantOrigin(tenant)}${path}`))?.status()).toBe(200);
      await expect(page.locator("html")).toHaveCSS("--brand-accent", tenant === "alpha" ? "#123456" : "#abcdef");
      const palette = await page.locator("html").evaluate(root => {
        const style = getComputedStyle(root);
        const read = (name: string) => style.getPropertyValue(`--${name}`).trim();
        const luminance = (hex: string) => {
          const c = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
        };
        const ratio = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
        return { primary: read("primary"), text: ratio(read("primary"), read("primary-foreground")), ui: Math.min(...["background", "card", "popover"].map(name => ratio(read("primary"), read(name)))) };
      });
      expect(palette.text).toBeGreaterThanOrEqual(4.5);
      expect(palette.ui).toBeGreaterThanOrEqual(3);
      palettes.push(palette.primary);
    }
    expect(palettes[0]).not.toBe(palettes[1]);
  }
});

test("hostile persisted values cannot inject CSS or HTML", async ({ page }) => {
  expect((await page.goto(`${tenantOrigin("hostile")}/`))?.status()).toBe(200);
  await expect(page.locator("script[data-brand-injected]")).toHaveCount(0);
  const style = await page.locator("html").getAttribute("style");
  expect(style).not.toContain("url(");
  expect(style).not.toContain("--injected");
  expect(style).not.toContain("<script");
  expect(await page.locator("html").evaluate((node) => getComputedStyle(node).getPropertyValue("--primary"))).toMatch(/^#[a-f0-9]{6}$/i);
});
