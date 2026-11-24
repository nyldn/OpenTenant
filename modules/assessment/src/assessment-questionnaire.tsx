"use client"

import { Check, ChevronLeft, ChevronRight, Sparkles, Users } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Textarea,
  FormField,
  cn,
} from "@opentenant/design-system"
import { LEVEL_COLORS, LEVEL_NAMES, levelText } from "./constants"
import {
  OPERATING_PROFILES,
  operatingProfileQuestionTips,
  type OperatingProfile,
} from "./data/operatingProfiles"
import { PILLARS } from "./data/pillars"
import { scoreKey } from "./engine"
import { Panel } from "./assessment-primitives"
import { useAssessment } from "./store"

export const RESPONSES = PILLARS.length
export const RESULTS = PILLARS.length + 1

export function ScoreButtons({ value, onPick, label }: { value: number; onPick: (v: number) => void; label: string }) {
  return (
    <div role="group" aria-label={`Maturity score for ${label}`} className="grid grid-cols-5 gap-1.5">
      {[1, 2, 3, 4, 5].map((v) => {
        const selected = value === v
        const fg = selected ? levelText(v) : undefined
        return (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            aria-pressed={selected}
            aria-label={`${v} ${LEVEL_NAMES[v]}`}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-md border px-1 py-2 text-center transition-colors",
              selected ? "border-transparent ring-2 ring-white/60" : "border-border bg-card text-muted-foreground hover:border-primary hover:bg-primary/10 hover:text-foreground",
            )}
            style={selected ? { background: LEVEL_COLORS[v], color: fg } : undefined}
          >
            <span className="text-sm font-bold tabular-nums">{v}</span>
            <span className="text-[11px] leading-tight" style={selected ? { color: fg } : undefined}>{LEVEL_NAMES[v]}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── one dimension card ──────────────────────────────────────────────────
export function DimensionCard({ pillarKey, dimIndex }: { pillarKey: string; dimIndex: number }) {
  const { scores, evidence, setScore, setEvidence, clientInfo } = useAssessment()
  const pillar = PILLARS.find((p) => p.key === pillarKey)!
  const dim = pillar.dimensions[dimIndex]
  const id = scoreKey(pillarKey, dim.key)
  const score = scores[id] || 0
  const profile = OPERATING_PROFILES.find((item) => item.value === clientInfo.operatingProfile)
  const questionTips = profile
    ? operatingProfileQuestionTips(profile.value as OperatingProfile, pillarKey, dimIndex)
    : []
  return (
    <Panel className={cn("scroll-mt-28 transition-shadow", score > 0 && "ring-white/[0.07]")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        {/* read: question + context + disclosures */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-2">
            <h3 className="text-[15px] font-bold text-foreground">{dim.name}</h3>
            {score > 0 && (
              <Badge className="border-0" style={{ background: LEVEL_COLORS[score], color: levelText(score) }}>{score} · {LEVEL_NAMES[score]}</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-foreground">{dim.question}</p>
          <p className="mt-2 border-l-2 border-primary/40 pl-3 text-[14px] leading-relaxed text-muted-foreground">{dim.context}</p>
          <Accordion type="multiple" className="mt-3 grid gap-2 text-[14px] sm:grid-cols-2">
            <AccordionItem value="probes" className="rounded-md border border-white/[0.06] bg-background/30 px-3">
              <AccordionTrigger className="py-2 text-[13px] font-semibold text-accent-text hover:no-underline">Question tips</AccordionTrigger>
              <AccordionContent className="pb-3">
                {profile ? (
                  <>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Synthetic example · {profile.label}</p>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">{questionTips.map((question) => <li key={question}>{question}</li>)}</ul>
                  </>
                ) : (
                  <p className="text-[13px] text-muted-foreground">Select an operating profile in the Session panel to show synthetic contextual questions.</p>
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="rubric" className="rounded-md border border-white/[0.06] bg-background/30 px-3">
              <AccordionTrigger className="py-2 text-[13px] font-semibold text-accent-text hover:no-underline">Scoring rubric</AccordionTrigger>
              <AccordionContent className="pb-3">
                <div className="flex flex-col gap-1">
                {(["1", "2", "3", "4", "5"] as const).map((lvl) => (
                  <div key={lvl} className="flex gap-2">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded text-center text-[12px] font-bold leading-5" style={{ background: LEVEL_COLORS[Number(lvl)], color: levelText(Number(lvl)) }}>{lvl}</span>
                    <span className="text-[13px] text-muted-foreground">{dim.rubric[lvl]}</span>
                  </div>
                ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        {/* act: score + notes */}
        <div className="lg:border-l lg:border-white/[0.06] lg:pl-6">
          <p className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Your score</p>
          <ScoreButtons value={score} onPick={(v) => setScore(pillarKey, dim.key, v)} label={dim.name} />
          <FormField name={`evidence-${id}`} label={`Evidence for ${dim.name}`} help="Optional. Add notes that support your score.">{control => <Textarea
            {...control}
            value={evidence[id] || ""}
            onChange={(e) => setEvidence(pillarKey, dim.key, e.target.value)}
            className="resize-y bg-background"
          />}</FormField>
        </div>
      </div>
    </Panel>
  )
}

// ── left rail: vertical staged-flow stepper ─────────────────────────────
export function PillarRail() {
  const { scores, currentPillar, setCurrentPillar, respondents } = useAssessment()
  const responsesActive = currentPillar === RESPONSES
  const resultsActive = currentPillar === RESULTS
  return (
    <Panel className="p-3 sm:p-3">
      <nav aria-label="Assessment stages" className="flex flex-col gap-0.5">
        {PILLARS.map((p, i) => {
          const scored = p.dimensions.filter((d) => (scores[scoreKey(p.key, d.key)] || 0) > 0).length
          const complete = scored === p.dimensions.length
          const active = i === currentPillar
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setCurrentPillar(i)}
              aria-current={active ? "step" : undefined}
              className={cn("flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors", active ? "bg-accent text-accent-foreground ring-1 ring-border" : "hover:bg-white/[0.03]")}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: complete ? "var(--success)" : active ? "var(--primary)" : "var(--muted)", color: complete ? "var(--success-foreground)" : active ? "var(--primary-foreground)" : "var(--muted-foreground)" }}>
                {complete ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="min-w-0 leading-tight">
                <span className={cn("block whitespace-normal break-words text-[13px] font-semibold", active ? "text-foreground" : complete ? "text-success-text" : "text-muted-foreground")}>{p.name}</span>
                <span className="block text-[11px] text-muted-foreground">{scored}/{p.dimensions.length} · {Math.round(p.weight * 100)}%</span>
              </span>
            </button>
          )
        })}
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Manage</p>
          <button
            type="button"
            onClick={() => setCurrentPillar(RESPONSES)}
            aria-current={responsesActive ? "step" : undefined}
            className={cn("flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors", responsesActive ? "bg-accent text-accent-foreground ring-1 ring-border" : "hover:bg-white/[0.03]")}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: responsesActive ? "var(--primary)" : "var(--muted)", color: responsesActive ? "var(--primary-foreground)" : "var(--muted-foreground)" }}>
              <Users className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className={cn("block whitespace-normal break-words text-[13px] font-semibold", responsesActive ? "text-foreground" : "text-muted-foreground")}>Responses</span>
              <span className="block text-[11px] text-muted-foreground">{respondents.length} saved · consolidation</span>
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setCurrentPillar(RESULTS)}
          aria-current={resultsActive ? "step" : undefined}
          className={cn("mt-1 flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors", resultsActive ? "bg-accent text-accent-foreground ring-1 ring-border" : "hover:bg-white/[0.03]")}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: resultsActive ? "var(--primary)" : "var(--muted)", color: resultsActive ? "var(--primary-foreground)" : "var(--muted-foreground)" }}>
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className={cn("block whitespace-normal break-words text-[13px] font-semibold", resultsActive ? "text-foreground" : "text-muted-foreground")}>AI Readiness</span>
            <span className="block text-[11px] text-muted-foreground">Dashboard & recommendations</span>
          </span>
        </button>
      </nav>
    </Panel>
  )
}

export function QuestionnaireScreen() {
  const { currentPillar, setCurrentPillar } = useAssessment()
  const pillar = PILLARS[currentPillar]
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">{pillar.name}</h2>
          <p className="mt-0.5 text-[14px] text-muted-foreground">{pillar.description}</p>
        </div>
        <Badge className="shrink-0 border-0 bg-primary/15 text-accent-text">{Math.round(pillar.weight * 100)}% weight</Badge>
      </div>
      <div className="grid gap-3">
        {pillar.dimensions.map((dimension, index) => <DimensionCard key={dimension.key} pillarKey={pillar.key} dimIndex={index} />)}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="outline" disabled={currentPillar === 0} onClick={() => setCurrentPillar(currentPillar - 1)}><ChevronLeft data-icon="inline-start" /> Previous</Button>
        {currentPillar === RESULTS - 1 ? (
          <Button onClick={() => setCurrentPillar(RESULTS)}><Sparkles data-icon="inline-start" /> Review & AI Readiness</Button>
        ) : (
          <Button onClick={() => setCurrentPillar(currentPillar + 1)}>Next <ChevronRight data-icon="inline-end" /></Button>
        )}
      </div>
    </section>
  )
}
