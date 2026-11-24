"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  Download,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@opentenant/design-system"
import { AssessmentTable } from "./assessment-table"
import { buildReadoutSummary, streamReadout } from "./ai"
import { MaturityRadar, PillarRadar, Quadrant } from "./components/charts"
import {
  LEVEL_COLORS,
  LEVEL_NAMES,
  PHASE_BG,
  PHASE_COLORS,
  PHASE_NAMES,
  PHASE_TEXT,
  levelText,
} from "./constants"
import { BENCHMARK } from "./data/benchmark"
import { PILLARS } from "./data/pillars"
import {
  computeDashboard,
  computePriorities,
  phaseItems,
  resolveScores,
  scoreKey,
  sprintItems,
} from "./engine"
import {
  downloadAssessmentCsv,
  downloadAssessmentJson,
} from "./assessment-exports"
import { benchmarkLink, Eyebrow, levelColor, Markdown, Panel } from "./assessment-primitives"
import { downloadAssessmentPdf } from "./pdf"
import { buildReadoutInput, readoutInputDigest, useAssessment } from "./store"
import type { DashboardResult } from "./types"
import type { EngagementReadout } from "./persistence/engagement-schema"

export function isStoredReadoutCurrent(readout: EngagementReadout | null, digest: string | null, digestInputVersion: string | null, activeInputVersion: string) {
  return readout !== null && readout.inputDigest !== null && readout.inputDigest === digest && digestInputVersion === activeInputVersion
}

export function readoutTextForPdf(readout: EngagementReadout | null, current: boolean) {
  return current ? readout?.text ?? "" : ""
}

export interface ReadoutRequestToken { id: number; signal: AbortSignal }
export class ReadoutRequestController {
  private nextId = 0
  private mounted = false
  private activeId = 0
  mount() { this.mounted = true; this.invalidate() }
  begin(signal: AbortSignal): ReadoutRequestToken { const token = { id: ++this.nextId, signal }; this.activeId = token.id; return token }
  invalidate() { this.activeId = ++this.nextId }
  unmount() { this.mounted = false; this.invalidate() }
  isLive(token: ReadoutRequestToken) { return this.mounted && this.activeId === token.id && !token.signal.aborted }
}

export interface ReadoutRequestRunnerArgs {
  controller: ReadoutRequestController
  token: ReadoutRequestToken
  requestDigest: () => Promise<string>
  stream: (onDelta: (text: string) => void, signal: AbortSignal) => Promise<string>
  afterDigest: () => Promise<string>
  inputIsCurrent: () => boolean
  save: (readout: EngagementReadout) => void
  setPreview: (text: string) => void
  setState: (state: "idle" | "loading" | "error") => void
}
export async function runReadoutRequest(args: ReadoutRequestRunnerArgs) {
  try {
    const requestDigest = await args.requestDigest()
    if (!args.controller.isLive(args.token)) return
    const complete = await args.stream((delta) => { if (args.controller.isLive(args.token)) args.setPreview(delta) }, args.token.signal)
    const afterDigest = await args.afterDigest()
    if (!args.controller.isLive(args.token)) return
    if (!complete.trim()) { args.setPreview(""); args.setState("error"); return }
    if (afterDigest === requestDigest && args.inputIsCurrent()) {
      args.save({ text: complete, generatedAt: new Date().toISOString(), inputDigest: requestDigest })
      args.setPreview("")
    } else args.setPreview("")
    args.setState("idle")
  } catch {
    if (!args.controller.isLive(args.token)) return
    args.setPreview("")
    if (args.inputIsCurrent()) args.setState("error")
  }
}

export function ResultsScreen({ onBack }: { onBack: () => void }) {
  const { engagementId, scores, evidence, respondents, clientInfo, readout, saveReadout } = useAssessment()
  const resolved = useMemo(() => resolveScores(scores, respondents), [scores, respondents])
  const dash = useMemo<DashboardResult>(() => computeDashboard(resolved, respondents.length > 0), [resolved, respondents.length])
  const priorities = useMemo(() => computePriorities(resolved), [resolved])
  const sprint = sprintItems(priorities)
  const [openSpiders, setOpenSpiders] = useState<Record<string, boolean>>({})
  const [readoutDigest, setReadoutDigest] = useState<string | null>(null)
  const [digestInputVersion, setDigestInputVersion] = useState<string | null>(null)
  const [preview, setPreview] = useState("")
  const [readoutState, setReadoutState] = useState<"idle" | "loading" | "error">("idle")
  const abortRef = useRef<AbortController | null>(null)
  const requestControllerRef = useRef(new ReadoutRequestController())
  const activeInputsRef = useRef({ session: { clientInfo, scores, evidence, currentPillar: 0 }, respondents })
  const activeInputVersionRef = useRef("")
  useEffect(() => { const controller = requestControllerRef.current; controller.mount(); return () => { abortRef.current?.abort(); controller.unmount() } }, [])
  activeInputsRef.current = { session: { clientInfo, scores, evidence, currentPillar: 0 }, respondents }
  const inputVersion = JSON.stringify([engagementId, buildReadoutInput(activeInputsRef.current.session, respondents)])
  activeInputVersionRef.current = inputVersion

  const currentReadout = isStoredReadoutCurrent(readout, readoutDigest, digestInputVersion, inputVersion)
  const displayReadout = preview || readout?.text || ""
  useEffect(() => { abortRef.current?.abort(); requestControllerRef.current.invalidate(); setPreview(""); setReadoutState("idle"); setReadoutDigest(null); setDigestInputVersion(null); let alive = true; void readoutInputDigest({ clientInfo, scores, evidence, currentPillar: 0 }, respondents).then((digest) => { if (alive) { setReadoutDigest(digest); setDigestInputVersion(inputVersion) } }); return () => { alive = false } }, [clientInfo, scores, evidence, respondents, inputVersion])
  const runReadout = async () => {
    if (dash.scoredCount === 0) return
    const requestInputVersion = inputVersion
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const token = requestControllerRef.current.begin(ctrl.signal)
    setReadoutState("loading"); setPreview("")
    await runReadoutRequest({
      controller: requestControllerRef.current,
      token,
      requestDigest: () => readoutInputDigest({ clientInfo, scores, evidence, currentPillar: 0 }, respondents),
      stream: (onDelta, signal) => streamReadout(buildReadoutSummary(clientInfo, dash, priorities), { onDelta, signal }),
      afterDigest: () => readoutInputDigest(activeInputsRef.current.session, activeInputsRef.current.respondents),
      inputIsCurrent: () => activeInputVersionRef.current === requestInputVersion,
      save: saveReadout,
      setPreview,
      setState: setReadoutState,
    })
  }
  const exportCsv = () => downloadAssessmentCsv(clientInfo.name, resolved, evidence)
  const exportJson = () => downloadAssessmentJson(clientInfo, dash, priorities, respondents)

  const viability =
    dash.overallScore >= 3.5 ? { label: "AI-Ready", bg: "var(--success)", fg: "var(--success-foreground)" } :
    dash.overallScore >= 2.5 ? { label: "Ready with Investment", bg: "var(--warning)", fg: "var(--warning-foreground)" } :
    { label: "Foundational Work Needed", bg: "var(--danger)", fg: "var(--danger-foreground)" }

  if (dash.scoredCount === 0) {
    return (
      <Panel>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Sparkles /></EmptyMedia>
            <EmptyTitle>No scores yet</EmptyTitle>
            <EmptyDescription>Score at least one dimension to generate the readiness dashboard and recommendations.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={onBack}><ChevronLeft data-icon="inline-start" /> Back to assessment</Button>
          </EmptyContent>
        </Empty>
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-black">AI Readiness</h2>
          <p className="text-[13px] text-muted-foreground">{clientInfo.name || "Organization"} · {dash.scoredCount}/{dash.totalDims} dimensions{dash.useConsolidated ? ` · consolidated across ${respondents.length}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void downloadAssessmentPdf(clientInfo, dash, priorities, readoutTextForPdf(readout, currentReadout))}>
            <Download data-icon="inline-start" /><span>Download PDF</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">Export data <ChevronDown data-icon="inline-end" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={exportCsv}><Download /> Export CSV</DropdownMenuItem>
              {/* Export JSON is the derived report format, separate from an engagement backup. */}
              <DropdownMenuItem onSelect={exportJson}><Download /> Export report JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={onBack}><ChevronLeft data-icon="inline-start" /> Back</Button>
        </div>
      </div>

      {/* AI executive readout */}
      <div className="rounded-lg bg-primary/[0.06] p-4 ring-1 ring-primary/25 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow className="flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> AI executive readout</Eyebrow>
          <Button size="sm" variant="outline" onClick={runReadout} disabled={readoutState === "loading"}>
            <RefreshCw data-icon="inline-start" className={cn(readoutState === "loading" && "animate-spin")} />
            {readoutState === "loading" ? "Generating" : "Regenerate"}
          </Button>
        </div>
        {displayReadout && <div className="mt-3"><Markdown text={displayReadout} /></div>}
        {readout && !currentReadout && <p className="mt-2 text-[13px] text-warning-text">This readout is stale. Regenerate it to reflect the current assessment.</p>}
        {readoutState === "loading" && !displayReadout && <p className="mt-2 text-[13px] text-muted-foreground">Generating executive readout…</p>}
        {readoutState === "error" && <p className="mt-2 text-[13px] text-danger-text">AI readout unavailable (no model key configured). The deterministic readout below is complete and shareable.</p>}
      </div>

      {/* key metrics */}
      <section className="grid gap-4 xl:grid-cols-2 xl:items-stretch">
        <Panel className="flex flex-col gap-5 sm:grid sm:grid-cols-[0.95fr_1.05fr] sm:gap-6">
          <div>
            <Eyebrow>Overall maturity</Eyebrow>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-5xl font-black leading-none tabular-nums" style={{ color: "var(--accent-text)" }}>{dash.overallScore || "n/a"}</span>
              <span className="pb-1 text-[13px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">Level {dash.overallLevel}<br />{LEVEL_NAMES[dash.overallLevel]}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className="border-0" style={{ background: viability.bg, color: viability.fg }}>{viability.label}</Badge>
              <Badge variant="outline">Readiness {dash.readiness}/5</Badge>
              <Badge variant="outline">{dash.qName}</Badge>
              {dash.highVariance && dash.bottleneckPillar && (<Badge variant="outline" className="text-warning-text"><AlertTriangle className="mr-1 h-3 w-3" />Bottleneck: {dash.bottleneckPillar}</Badge>)}
            </div>
          </div>
          <div className="border-t border-white/[0.06] pt-5 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
            <Eyebrow>70-20-10 readiness</Eyebrow>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              {[["People & Process", dash.ppAvg, "70%"], ["Tech & Data", dash.tdAvg, "20%"], ["Algorithms", dash.algoAvg, "10%"]].map(([label, val, w]) => (
                <div key={label as string}>
                  <div className="text-xl font-black tabular-nums text-accent-text">{val as number}</div>
                  <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
                  <div className="text-[11px] text-muted-foreground">{w}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3">
              {dash.ready.length > 0 && <Badge className="border-0" style={{ background: "var(--success)", color: "var(--success-foreground)" }}>{dash.ready.length} AI-ready</Badge>}
              {dash.nearReady.length > 0 && <Badge className="border-0" style={{ background: "var(--warning)", color: "var(--warning-foreground)" }}>{dash.nearReady.length} ready w/ investment</Badge>}
              {dash.needsWork.length > 0 && <Badge className="border-0" style={{ background: "var(--danger)", color: "var(--danger-foreground)" }}>{dash.needsWork.length} foundational</Badge>}
            </div>
          </div>
        </Panel>
        <Panel className="flex flex-col">
          <Eyebrow className="mb-2">Strategic position · {dash.qName}</Eyebrow>
          <div className="flex flex-1 items-center justify-center">
            <Quadrant qX={dash.qX} qY={dash.qY} label={clientInfo.name || "Organization"} />
          </div>
        </Panel>
      </section>

      <Panel>
        <div className="mb-1 flex items-center justify-between">
          <Eyebrow>Maturity profile vs benchmark</Eyebrow>
          <a href={benchmarkLink()} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] text-accent-text underline-offset-2 hover:underline"><ExternalLink className="h-3 w-3" /> Sources</a>
        </div>
        <MaturityRadar pillarResults={dash.pillarResults} />
        <p className="mt-1 text-[12px] text-muted-foreground">{BENCHMARK.method_note}</p>
      </Panel>

      {/* pillar table */}
      <Panel>
        <Eyebrow className="mb-2">Pillar performance</Eyebrow>
        <AssessmentTable label="Pillar performance" className="text-[14px]">
            <TableHeader>
              <TableRow className="text-[12px] uppercase tracking-wide text-muted-foreground hover:bg-transparent">
                <TableHead className="py-1.5 text-left font-semibold text-muted-foreground">Pillar</TableHead>
                <TableHead className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Score</TableHead>
                <TableHead className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Median</TableHead>
                <TableHead className="px-2 py-1.5 text-right font-semibold text-muted-foreground">High</TableHead>
                <TableHead className="w-[32%] px-2 py-1.5 text-left font-semibold text-muted-foreground">Profile</TableHead>
                <TableHead className="py-1.5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {dash.pillarResults.map((p) => {
                const b = BENCHMARK.pillars[p.key]
                const isOpen = !!openSpiders[p.key]
                return (
                  <Fragment key={p.key}>
                    <TableRow className="border-white/[0.06] transition-colors hover:bg-white/[0.02]">
                      <TableCell className="py-2 font-semibold">{p.name} <span className="font-normal text-muted-foreground">· {Math.round(p.weight * 100)}%</span></TableCell>
                      <TableCell className="px-2 py-2 text-right font-bold tabular-nums" style={{ color: p.avg ? "var(--accent-text)" : "var(--muted-foreground)" }}>{p.avg || "n/a"}</TableCell>
                      <TableCell className="px-2 py-2 text-right tabular-nums text-muted-foreground">{b?.industry_median ?? "n/a"}</TableCell>
                      <TableCell className="px-2 py-2 text-right tabular-nums text-muted-foreground">{b?.high_performer ?? "n/a"}</TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(p.avg / 5) * 100}%`, background: p.avg ? levelColor(p.avg) : "var(--muted-foreground)" }} /></div>
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        <button type="button" aria-expanded={isOpen} aria-controls={`spider-${p.key}`} onClick={() => setOpenSpiders((s) => ({ ...s, [p.key]: !s[p.key] }))} className="inline-flex items-center gap-1 text-[12px] text-accent-text underline-offset-2 hover:underline"><Activity className="h-3 w-3" /> {isOpen ? "Hide" : "Spider"}</button>
                      </TableCell>
                    </TableRow>
                    {isOpen && (<TableRow><TableCell colSpan={6} id={`spider-${p.key}`} className="pb-2"><PillarRadar pillarKey={p.key} scores={resolved} /></TableCell></TableRow>)}
                  </Fragment>
                )
              })}
            </TableBody>
          </AssessmentTable>
      </Panel>

      {/* heatmap */}
      <Panel>
        <Eyebrow className="mb-2">Dimension heatmap</Eyebrow>
        <AssessmentTable label="Dimension heatmap" className="text-[12px]">
          <TableBody>
            {PILLARS.map((p) => (
              <TableRow key={p.key} className="border-white/[0.06] hover:bg-transparent">
                <TableCell className="py-1.5 pr-2 font-semibold text-muted-foreground">{p.name}</TableCell>
                {p.dimensions.map((d) => {
                  const s = resolved[scoreKey(p.key, d.key)] || 0
                  return (
                    <TableCell key={d.key} className="px-0.5 py-1.5">
                      <div title={`${d.name}: ${s || "not scored"}`} className="mx-auto flex h-7 w-7 items-center justify-center rounded" style={{ background: s ? LEVEL_COLORS[Math.round(s)] : "var(--muted)", color: s ? levelText(s) : undefined }}>{s ? s : ""}</div>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </AssessmentTable>
      </Panel>

      {/* gaps */}
      {(dash.critical.length > 0 || dash.moderate.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Eyebrow className="text-danger-text">Critical gaps</Eyebrow>
            <div className="mt-2 divide-y divide-white/[0.05]">
              {dash.critical.length ? dash.critical.map((g) => (
                <div key={g.name} className="flex items-center justify-between py-1.5 text-[13px]"><span>{g.name} <span className="text-muted-foreground">· {g.pillar}</span></span><span className="tabular-nums text-muted-foreground">{g.score} (gap {g.gap})</span></div>
              )) : <p className="py-1.5 text-[13px] text-muted-foreground">None.</p>}
            </div>
          </Panel>
          <Panel>
            <Eyebrow className="text-warning-text">Moderate gaps</Eyebrow>
            <div className="mt-2 divide-y divide-white/[0.05]">
              {dash.moderate.length ? dash.moderate.slice(0, 8).map((g) => (
                <div key={g.name} className="flex items-center justify-between py-1.5 text-[13px]"><span>{g.name} <span className="text-muted-foreground">· {g.pillar}</span></span><span className="tabular-nums text-muted-foreground">{g.score} (gap {g.gap})</span></div>
              )) : <p className="py-1.5 text-[13px] text-muted-foreground">None.</p>}
            </div>
          </Panel>
        </div>
      )}

      {/* recommendations */}
      <Panel>
        <Eyebrow className="mb-1">30-day sprint, top priorities</Eyebrow>
        {sprint.length ? (
          <ol className="divide-y divide-white/[0.06]">
            {sprint.map((it, i) => (
              <li key={it.dimKey} className="flex gap-3 py-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
                    <span className="font-semibold text-foreground">{it.dimName}</span>
                    <span className="text-muted-foreground">{it.pillarName}</span>
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: ["var(--danger-text)", "var(--warning-text)", "var(--info-text)", "var(--success-text)"][it.phase] }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: PHASE_COLORS[it.phase] }} />{PHASE_NAMES[it.phase]}</span>
                  </div>
                  <p className="mt-0.5 text-[14px] text-muted-foreground">{it.activity}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="mt-1 text-[14px] text-muted-foreground">Score more dimensions to generate a sprint.</p>}
      </Panel>
      <Panel>
        <Eyebrow className="mb-2">Full priority stack by phase</Eyebrow>
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3].map((ph) => {
            const items = phaseItems(priorities, ph)
            if (!items.length) return null
            return (
              <div key={ph}>
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="rounded px-2 py-0.5 text-[12px] font-bold" style={{ background: PHASE_BG[ph], color: PHASE_TEXT[ph] }}>{PHASE_NAMES[ph]}</span>
                  <span className="text-[12px] text-muted-foreground">{items.length} item(s)</span>
                </div>
                <ul className="divide-y divide-white/[0.06]">
                  {items.map((it) => (
                    <li key={it.dimKey} className="py-2">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[13px] font-semibold text-foreground">{it.dimName}</span>
                        <span className="text-[12px] text-muted-foreground">{it.pillarName}</span>
                        <span className="text-[12px] font-semibold" style={{ color: "var(--info-text)" }}>{it.type}</span>
                        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">PS {it.priorityScore}</span>
                      </div>
                      <p className="mt-0.5 text-[14px] text-muted-foreground">{it.activity}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </Panel>

    </div>
  )
}
