// Client side of the AI executive readout. Builds a compact, deterministic
// summary of the computed results and streams a narrative from /api/assessment-readout.
// All numbers are pre-computed here; the model only narrates, it does not score.

import type { DashboardResult, PriorityItem } from "./types"
import { BENCHMARK } from "./data/benchmark"
import { LEVEL_NAMES } from "./constants"
import type { ClientInfo } from "./store"
import { getAssessmentRuntimeConfig } from "./runtime"

export function buildReadoutSummary(
  clientInfo: ClientInfo,
  dash: DashboardResult,
  priorities: PriorityItem[],
): string {
  const lines: string[] = []
  lines.push(`Client: ${clientInfo.name || "Unnamed organization"}${clientInfo.department ? ` (${clientInfo.department})` : ""}`)
  lines.push(`Overall maturity: ${dash.overallScore}/5 — Level ${dash.overallLevel} (${LEVEL_NAMES[dash.overallLevel]})`)
  lines.push(`Coverage: ${dash.scoredCount} of ${dash.totalDims} dimensions scored${dash.useConsolidated ? " (consolidated across respondents)" : ""}.`)
  lines.push(`70-20-10 transformation readiness: ${dash.readiness}/5 (People & Process ${dash.ppAvg}, Tech & Data ${dash.tdAvg}, Algorithms ${dash.algoAvg}).`)
  lines.push(`Strategic quadrant: ${dash.qName} (technical foundation ${dash.qX}, strategic readiness ${dash.qY}; midpoint 2.5).`)
  if (dash.highVariance && dash.bottleneckPillar) lines.push(`High cross-pillar variance (std dev ${dash.stdDev}); bottleneck pillar: ${dash.bottleneckPillar}.`)
  lines.push("")
  lines.push("Pillar scores vs public benchmark (your / industry median / high performer):")
  for (const p of dash.pillarResults) {
    const b = BENCHMARK.pillars[p.key]
    lines.push(`- ${p.name} (weight ${Math.round(p.weight * 100)}%): ${p.avg || "n/a"} / ${b?.industry_median ?? "n/a"} / ${b?.high_performer ?? "n/a"}`)
  }
  if (dash.critical.length) {
    lines.push("")
    lines.push(`Critical gaps (gap >= 2): ${dash.critical.slice(0, 6).map((g) => `${g.name} [${g.pillar}] score ${g.score}`).join("; ")}`)
  }
  if (dash.moderate.length) {
    lines.push(`Moderate gaps: ${dash.moderate.slice(0, 6).map((g) => g.name).join("; ")}`)
  }
  const sprint = priorities.slice(0, 7)
  if (sprint.length) {
    lines.push("")
    lines.push("30-day sprint (top priorities, by weighted priority score):")
    sprint.forEach((it, i) => lines.push(`${i + 1}. [${it.type}] ${it.dimName} (${it.pillarName}, PS ${it.priorityScore}): ${it.activity}`))
  }
  lines.push("")
  lines.push(`Benchmark sources: ${BENCHMARK.sources.join(", ")}. ${BENCHMARK.method_note}`)
  return lines.join("\n")
}

export interface ReadoutHandlers {
  onDelta: (text: string) => void
  signal?: AbortSignal
}

export type ReadoutTransportErrorCode = "unavailable" | "failed"

export class ReadoutTransportError extends Error {
  readonly code: ReadoutTransportErrorCode

  constructor(code: ReadoutTransportErrorCode) {
    super(code === "unavailable" ? "model unavailable" : "readout failed")
    this.name = "ReadoutTransportError"
    this.code = code
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}

type ReadoutEvent =
  | { type: "delta"; value: string }
  | { type: "done" }
  | { type: "error" }

function parseReadoutEvent(value: unknown): ReadoutEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReadoutTransportError("failed")
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1) throw new ReadoutTransportError("failed")
  if (keys[0] === "delta" && typeof record.delta === "string") {
    return { type: "delta", value: record.delta }
  }
  if (keys[0] === "done" && record.done === true) return { type: "done" }
  if (keys[0] === "error" && typeof record.error === "string") return { type: "error" }
  throw new ReadoutTransportError("failed")
}

/** Streams the readout and exposes only bounded transport failures. */
export async function streamReadout(summary: string, handlers: ReadoutHandlers): Promise<string> {
  try {
    const res = await fetch(getAssessmentRuntimeConfig().readoutEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary }),
      ...(handlers.signal ? { signal: handlers.signal } : {}),
    })
    if (!res.ok) {
      throw new ReadoutTransportError(res.status === 503 ? "unavailable" : "failed")
    }
    if (!res.body) throw new ReadoutTransportError("failed")
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    let full = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n\n"); buf = lines.pop() ?? ""
      for (const line of lines) {
        const message = line.trim()
        if (!message.startsWith("data: ")) continue
        let parsed: unknown
        try { parsed = JSON.parse(message.slice(6)) as unknown } catch {
          throw new ReadoutTransportError("failed")
        }
        const event = parseReadoutEvent(parsed)
        if (event.type === "error") throw new ReadoutTransportError("failed")
        if (event.type === "delta") { full += event.value; handlers.onDelta(full) }
        if (event.type === "done") return full
      }
    }
    throw new ReadoutTransportError("failed")
  } catch (error) {
    if (error instanceof ReadoutTransportError || isAbortError(error)) throw error
    throw new ReadoutTransportError("failed")
  }
}
