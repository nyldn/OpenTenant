import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip,
} from "recharts"
import type { PillarResult } from "../types"
import { BENCHMARK } from "../data/benchmark"
import { PILLARS } from "../data/pillars"

const ORANGE = "#EA580C"
const MEDIAN = "#94A3B8"
const HIGH = "#34D399"

// Main dashboard spider: your pillar averages vs industry median vs high performer.
export function MaturityRadar({ pillarResults }: { pillarResults: PillarResult[] }) {
  const data = pillarResults.map((p) => {
    const b = BENCHMARK.pillars[p.key]
    return {
      axis: p.name.replace(/ & /g, " &\n"),
      your: p.avg,
      median: b?.industry_median ?? 0,
      high: b?.high_performer ?? 0,
    }
  })
  return (
    <div className="h-[340px] min-w-0 w-full overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} />
          <Radar name="Your score" dataKey="your" stroke={ORANGE} fill={ORANGE} fillOpacity={0.35} strokeWidth={2} />
          <Radar name="Industry median" dataKey="median" stroke={MEDIAN} fill={MEDIAN} fillOpacity={0.08} strokeWidth={1.5} />
          <Radar name="High performer" dataKey="high" stroke={HIGH} fill={HIGH} fillOpacity={0.05} strokeWidth={1.5} strokeDasharray="4 3" />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={value => <span className="text-muted-foreground">{value}</span>} />
          <Tooltip
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// 2x2 strategic-position quadrant: technical foundation (x) vs strategic
// readiness (y), midpoint 2.5. The org is plotted; its quadrant is highlighted.
export function Quadrant({ qX, qY, label }: { qX: number; qY: number; label: string }) {
  const left = `${Math.max(4, Math.min(96, (qX / 5) * 100))}%`
  const bottom = `${Math.max(4, Math.min(96, (qY / 5) * 100))}%`
  const hiX = qX >= 2.5, hiY = qY >= 2.5
  const cell = (a: boolean) => (a ? "bg-primary/15" : "")
  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-[220px]">
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-md ring-1 ring-white/[0.08]">
          <div className={cell(!hiX && hiY)} />
          <div className={cell(hiX && hiY)} />
          <div className={cell(!hiX && !hiY)} />
          <div className={cell(hiX && !hiY)} />
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/[0.1]" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/[0.1]" />
        <span className="absolute left-1.5 top-1.5 text-[9px] leading-tight text-muted-foreground">Aspiration<br />Gap</span>
        <span className="absolute right-1.5 top-1.5 text-right text-[9px] leading-tight text-accent-text">Scale &<br />Lead</span>
        <span className="absolute bottom-1.5 left-1.5 text-[9px] leading-tight text-muted-foreground">Foundation<br />Stage</span>
        <span className="absolute bottom-1.5 right-1.5 text-right text-[9px] leading-tight text-muted-foreground">Capability<br />Builder</span>
        <div className="absolute h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-card" style={{ left, bottom, background: ORANGE }} title={`${label} (technical ${qX}, strategic ${qY})`} />
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Technical foundation (x) · Strategic readiness (y)</p>
    </div>
  )
}

// Per-pillar spider: that pillar's 5 dimension scores (no peer overlay; the
// public benchmark only has pillar-level medians).
export function PillarRadar({ pillarKey, scores }: { pillarKey: string; scores: Record<string, number> }) {
  const pillar = PILLARS.find((p) => p.key === pillarKey)
  if (!pillar) return null
  const data = pillar.dimensions.map((d) => ({
    axis: d.name.split(" ").slice(0, 2).join(" "),
    value: scores[`${pillarKey}__${d.key}`] || 0,
  }))
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} />
          <Radar name={`${pillar.name} dimensions`} dataKey="value" stroke={ORANGE} fill={ORANGE} fillOpacity={0.35} strokeWidth={2} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
