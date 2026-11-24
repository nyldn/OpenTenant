/** Raw brand accents are decorative. Semantic roles are resolved against every surface. */
export type PaletteMode = "light" | "dark"
export interface PaletteBrand {
  colorPrimary?: string
  colorBackground?: string
  colorForeground?: string
}
export type SemanticPalette = Readonly<Record<`--${string}`, string>>

function color(value: string | undefined, fallback: string) {
  return value && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}
function channels(hex: string) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
}
function luminance(hex: string) {
  const [r = 0, g = 0, b = 0] = channels(hex).map(v => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}
export function contrastRatio(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
function mix(a: string, b: string, amount: number) {
  const target = channels(b)
  return `#${channels(a).map((v, i) => Math.round(v + (target[i]! - v) * amount).toString(16).padStart(2, "0")).join("")}`
}
function ink(background: string) {
  return contrastRatio("#000000", background) >= contrastRatio("#ffffff", background) ? "#000000" : "#ffffff"
}
function readable(candidate: string, surfaces: string[], minimum: number, fallback: string) {
  for (let step = 0; step <= 100; step++) {
    const value = mix(candidate, fallback, step / 100)
    if (surfaces.every(bg => contrastRatio(value, bg) >= minimum)) return value
  }
  return fallback
}

/** Omit mode to honour the tenant background, even beneath a forced dark class.
 * Pass mode when rendering an explicit light/dark preview without a custom background.
 * An unusable foreground is replaced deterministically; raw accents stay separate.
 */
export function resolveSemanticPalette(brand: PaletteBrand = {}, mode: PaletteMode = "light"): SemanticPalette {
  const background = color(brand.colorBackground, mode === "dark" ? "#0a1628" : "#ffffff")
  const fallback = ink(background)
  const surfaceCandidate = mix(background, fallback, 0.04)
  const card = contrastRatio(fallback, surfaceCandidate) >= 4.5 ? surfaceCandidate : background
  const surfaces = [background, card]
  const foreground = readable(color(brand.colorForeground, fallback), surfaces, 4.5, fallback)
  const raw = color(brand.colorPrimary, "#ea580c")
  const primary = readable(raw, surfaces, 3, fallback)
  const text = (value: string) => readable(value, surfaces, 4.5, fallback)
  const boundary = readable(mix(background, fallback, 0.35), surfaces, 3, fallback)
  const palette: Record<`--${string}`, string> = {
    "--background": background, "--foreground": foreground, "--background-foreground": foreground,
    "--card": card, "--card-foreground": foreground,
    "--popover": card, "--popover-foreground": foreground,
    "--primary": primary, "--primary-foreground": ink(primary), "--primary-text": text(raw),
    "--secondary": card, "--secondary-foreground": foreground,
    "--muted": card, "--muted-foreground": text(mix(foreground, background, 0.3)),
    "--accent": card, "--accent-foreground": foreground, "--accent-text": text(raw),
    "--border": mix(background, fallback, 0.2), "--input": boundary,
    "--ring": readable(raw, surfaces, 3, fallback),
    "--sidebar": background, "--sidebar-foreground": foreground,
    "--sidebar-primary": primary, "--sidebar-primary-foreground": ink(primary),
    "--sidebar-accent": card, "--sidebar-accent-foreground": foreground,
    "--sidebar-border": boundary, "--sidebar-ring": readable(raw, surfaces, 3, fallback),
    "--brand-accent": raw, "--chart-1": raw, "--chart-2": "#73d100", "--chart-3": "#8400ff", "--chart-4": "#fb4671", "--chart-5": "#0047ff",
    "--purple-text": text("#8400ff"),
  }
  for (const [name, rawStatus] of Object.entries({ success: "#3d7000", warning: "#a34b00", danger: "#c01744", info: "#0047ff" })) {
    palette[`--${name}`] = card
    palette[`--${name}-foreground`] = text(rawStatus)
    palette[`--${name}-text`] = text(rawStatus)
  }
  const destructive = readable("#c01744", surfaces, 3, fallback)
  palette["--destructive"] = destructive
  palette["--destructive-foreground"] = ink(destructive)
  return palette
}
