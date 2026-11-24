import type { CSSProperties } from "react";
import { PLATFORM_BRAND_DEFAULTS, type BrandTokens } from "@opentenant/platform-core";
import { resolveSemanticPalette, type PaletteMode } from "@opentenant/design-system/lib/semantic-palette";

/** Only fixed variable names and a narrow value grammar reach React's style serializer. */
export function tenantBrandStyle(brand: BrandTokens, mode?: PaletteMode): CSSProperties {
  const font = (value: string, fallback: string) => /^[a-zA-Z][a-zA-Z0-9 ,'-]{0,159}$/.test(value) ? value : fallback;
  return {
    ...resolveSemanticPalette(brand, mode),
    "--font-sans": font(brand.fontFamilyBody, PLATFORM_BRAND_DEFAULTS.fontFamilyBody),
    "--font-display": font(brand.fontFamilyHeading, PLATFORM_BRAND_DEFAULTS.fontFamilyHeading),
  } as CSSProperties;
}
