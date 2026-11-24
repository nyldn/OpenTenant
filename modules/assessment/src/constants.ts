// Phase + maturity-level presentation constants, verbatim from the artifact.
export const PHASE_NAMES = [
  "Phase 0 — Foundation",
  "Phase 1 — Activation",
  "Phase 2 — Scale",
  "Phase 3 — Lead",
]
export const PHASE_COLORS = ["#E74C3C", "#F5A623", "#3498DB", "#27AE60"]
export const PHASE_BG = ["var(--danger)", "var(--warning)", "var(--info)", "var(--success)"]
export const PHASE_TEXT = ["var(--danger-foreground)", "var(--warning-foreground)", "var(--info-foreground)", "var(--success-foreground)"]

export const LEVEL_NAMES: Record<number, string> = {
  1: "Ad-hoc",
  2: "Developing",
  3: "Defined",
  4: "Advanced",
  5: "Leading",
}
// Score labels always use a complete semantic surface/foreground pair.
export const LEVEL_COLORS: Record<number, string> = {
  1: "var(--danger)",
  2: "var(--warning)",
  3: "var(--info)",
  4: "var(--success)",
  5: "var(--primary)",
}
export const LEVEL_TEXT: Record<number, string> = {
  1: "var(--danger-foreground)",
  2: "var(--warning-foreground)",
  3: "var(--info-foreground)",
  4: "var(--success-foreground)",
  5: "var(--primary-foreground)",
}
export const levelText = (score: number) => LEVEL_TEXT[Math.max(1, Math.min(5, Math.round(score)))]
