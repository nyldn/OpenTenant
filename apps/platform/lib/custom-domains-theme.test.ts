import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLATFORM_BRAND_DEFAULTS } from "@opentenant/platform-core";
import { tenantBrandStyle } from "./custom-domains-theme";

// Independent WCAG 2.x oracle: do not use the palette generator's contrast code.
function ratio(a: string, b: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
const surfaces = ["background", "card", "popover", "secondary", "muted", "accent", "sidebar", "sidebar-accent"];
function assertPalette(style: Record<string, string>) {
  for (const name of [...surfaces, "primary", "destructive", "sidebar-primary", "success", "warning", "danger", "info"]) {
    expect(style[`--${name}`], name).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ratio(style[`--${name}`]!, style[`--${name}-foreground`]!), name).toBeGreaterThanOrEqual(4.5);
  }
  for (const name of surfaces) {
    for (const text of ["muted-foreground", "primary-text", "accent-text", "success-text", "warning-text", "danger-text", "purple-text"]) {
      expect(ratio(style[`--${name}`]!, style[`--${text}`]!), `${text} on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const ui of ["primary", "destructive", "ring", "input", "sidebar-ring", "sidebar-border"]) {
      expect(ratio(style[`--${name}`]!, style[`--${ui}`]!), `${ui} on ${name}`).toBeGreaterThanOrEqual(3);
    }
  }
}
describe("semantic palette", () => {
  it("resolves every pair even when a light tenant renders under dark chrome", () => {
    assertPalette(tenantBrandStyle({ ...PLATFORM_BRAND_DEFAULTS, colorBackground: "#ffffff", colorForeground: "#111111" }) as Record<string, string>);
  });
  it("validates adversarial tenant colours and CSS before serializing", () => {
    for (const background of ["#ffffff", "#000000", "#777777", "#00ffff", "#ff00ff", "#ffff00", "#0a1628", "bad; color:red"]) {
      for (const primary of ["#ffffff", "#000000", "#777777", "#ffff00", "var(--bad)"]) {
        for (const foreground of [background, "#111111", "#ffffff", "url(https://example.test)"]) {
          const style = tenantBrandStyle({ ...PLATFORM_BRAND_DEFAULTS, colorBackground: background, colorPrimary: primary, colorForeground: foreground, fontFamilyBody: "url(evil)" }) as Record<string, string>;
          assertPalette(style);
          expect(style["--font-sans"]).toBe(PLATFORM_BRAND_DEFAULTS.fontFamilyBody);
          expect(style).toEqual(tenantBrandStyle({ ...PLATFORM_BRAND_DEFAULTS, colorBackground: background, colorPrimary: primary, colorForeground: foreground, fontFamilyBody: "url(evil)" }));
        }
      }
    }
  });
  it("keeps all standalone light and dark CSS pairs accessible", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    for (const selector of [":root", ".dark"]) {
      const block = css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]+)\\}`))![1]!;
      const style = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/gi)].map(m => [m[1]!, m[2]!]));
      assertPalette(style);
    }
  });
});
