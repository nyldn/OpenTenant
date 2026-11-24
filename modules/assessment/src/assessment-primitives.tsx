import type { ReactNode } from "react"
import { cn } from "@opentenant/design-system"
import { LEVEL_COLORS } from "./constants"
import { getAssessmentPublicUrl, getAssessmentRuntimeConfig } from "./runtime"

// Resolve at call time so configureAssessmentRuntime() from the platform shell
// takes effect after module evaluation.
export const runtimeConfig = () => getAssessmentRuntimeConfig()
export const benchmarkLink = () => getAssessmentPublicUrl()

export function Markdown({ text }: { text: string }) {
  const format = (value: string) =>
    value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
        : <span key={index}>{part}</span>,
    )
  return (
    <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-muted-foreground">
      {text.split("\n").map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return null
        if (trimmed.startsWith("## ")) return <h3 key={index} className="pt-2 text-[14px] font-bold uppercase tracking-wide text-accent-text">{trimmed.slice(3)}</h3>
        if (trimmed.startsWith("- ")) return <p key={index} className="pl-3">• {format(trimmed.slice(2))}</p>
        return <p key={index}>{format(trimmed)}</p>
      })}
    </div>
  )
}

export function levelColor(score: number) {
  return LEVEL_COLORS[Math.max(1, Math.min(5, Math.round(score)))]
}

export function OpenTenantLogo() {
  const brand = runtimeConfig().brand
  if (!brand.logoUrl) return <span className="text-sm font-bold">{brand.displayName}</span>
  return <img src={brand.logoUrl} alt={brand.displayName} className="h-6 w-auto" />
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("min-w-0 rounded-lg bg-card p-4 text-card-foreground ring-1 ring-white/[0.04] sm:p-5", className)}>{children}</section>
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[12px] font-bold uppercase tracking-[0.1em] text-accent-text", className)}>{children}</p>
}
