// Deterministic scoring engine for the AI Maturity Assessment.
//
// Ported 1:1 from the v2.6 artifact's <script> calculations (computePillarResults,
// generateDashboard, computePriorities, consolidatedScore, getPhaseIndex). All
// rounding matches the source: 2 decimals for averages/overall/consolidated,
// 1 decimal for gaps and priority scores. Functions are pure so the math can be
// unit-tested in isolation (the highest-risk part of the port).

import type {
  Pillar, ScoreMap, Respondent, Library,
  PillarResult, DashboardResult, PriorityItem,
} from "./types"
import { PILLARS } from "./data/pillars"
import { LIBRARY } from "./data/library"

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10

export const scoreKey = (pillarKey: string, dimKey: string) => `${pillarKey}__${dimKey}`
export const totalDims = (pillars: Pillar[] = PILLARS) =>
  pillars.reduce((n, p) => n + p.dimensions.length, 0)

/**
 * Effective per-dimension scores. When respondents exist, each dimension is the
 * mean across respondents that scored it (rounded to 2dp), falling back to the
 * live session score when no respondent scored that dimension. Mirrors the
 * artifact's consolidatedScore + `useConsolidated = respondents.length > 0`.
 * Only positive scores are emitted, so downstream "scored" checks (`s > 0`) hold.
 */
export function resolveScores(sessionScores: ScoreMap, respondents: Respondent[] = []): ScoreMap {
  if (!respondents.length) {
    const out: ScoreMap = {}
    for (const [k, v] of Object.entries(sessionScores)) if (v > 0) out[k] = v
    return out
  }
  const out: ScoreMap = {}
  for (const p of PILLARS) {
    for (const d of p.dimensions) {
      const id = scoreKey(p.key, d.key)
      const vals = respondents
        .map((r) => r.scores[id])
        .filter((v): v is number => v !== undefined && v !== null)
      const v = vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : (sessionScores[id] || 0)
      if (v > 0) out[id] = v
    }
  }
  return out
}

export function computePillarResults(scores: ScoreMap, pillars: Pillar[] = PILLARS): PillarResult[] {
  return pillars.map((p) => {
    const dimScores = p.dimensions
      .map((d) => scores[scoreKey(p.key, d.key)] || 0)
      .filter((s) => s > 0)
    const avg = dimScores.length ? round2(dimScores.reduce((a, b) => a + b, 0) / dimScores.length) : 0
    return { key: p.key, name: p.name, weight: p.weight, avg, coverage: dimScores.length / p.dimensions.length }
  })
}

export function getPhaseIndex(score: number): number {
  if (score <= 2.0) return 0
  if (score <= 3.0) return 1
  if (score <= 4.0) return 2
  return 3
}

export function computeDashboard(scores: ScoreMap, useConsolidated = false): DashboardResult {
  const pillarResults = computePillarResults(scores)

  const weightedSum = pillarResults.reduce((s, p) => s + p.avg * p.weight, 0)
  const totalWeightWithData = pillarResults.filter((p) => p.avg > 0).reduce((s, p) => s + p.weight, 0)
  const overallScore = totalWeightWithData > 0 ? round2(weightedSum / totalWeightWithData) : 0
  const overallLevel = Math.max(1, Math.min(5, Math.round(overallScore)))

  // 70-20-10 transformation readiness
  const byKey = (k: string) => pillarResults.find((p) => p.key === k)!
  const pp = ["strategy", "business_processes_governance", "org_culture_talent"].map(byKey).filter((p) => p.avg > 0)
  const td = ["data_infrastructure", "technology_tools"].map(byKey).filter((p) => p.avg > 0)
  const ppAvg = pp.length ? round2(pp.reduce((s, p) => s + p.avg, 0) / pp.length) : 0
  const tdAvg = td.length ? round2(td.reduce((s, p) => s + p.avg, 0) / td.length) : 0
  // Algorithms is the artifact's min() proxy. The `|| 5` guard avoids penalizing
  // it when only one of P&P / T&D has data, but on a wholly empty assessment it
  // would fabricate algoAvg=5 (readiness 0.5); short-circuit that degenerate case.
  const algoAvg = ppAvg || tdAvg ? Math.min(ppAvg || 5, tdAvg || 5) : 0
  const readiness = round2(0.7 * ppAvg + 0.2 * tdAvg + 0.1 * algoAvg)

  // 2x2 strategic-position quadrant
  const qX = tdAvg
  const qY = ppAvg
  const QMID = 2.5
  const qName =
    qX >= QMID && qY >= QMID ? "Scale & Lead" :
    qX < QMID && qY >= QMID ? "Aspiration Gap" :
    qX >= QMID && qY < QMID ? "Capability Builder" :
    "Foundation Stage"

  // cross-pillar variance (population std dev over pillars with data)
  const avgs = pillarResults.filter((p) => p.avg > 0).map((p) => p.avg)
  const mean = avgs.reduce((a, b) => a + b, 0) / (avgs.length || 1)
  const variance = avgs.length ? avgs.reduce((s, v) => s + (v - mean) ** 2, 0) / avgs.length : 0
  const stdDev = round2(Math.sqrt(variance))
  // Net-new beyond the artifact (the PoC computes stdDev but does not flag/name a
  // bottleneck). 0.8 is a OpenTenant example threshold, not sourced from the artifact.
  const highVariance = stdDev >= 0.8
  const scoredPillars = pillarResults.filter((p) => p.avg > 0)
  const bottleneckPillar = highVariance && scoredPillars.length
    ? scoredPillars.reduce((lo, p) => (p.avg < lo.avg ? p : lo)).name
    : null

  // gap analysis (scored dimensions below 4.0)
  const gaps: DashboardResult["critical"] = []
  for (const p of PILLARS) {
    for (const d of p.dimensions) {
      const s = scores[scoreKey(p.key, d.key)] || 0
      if (s && s < 4) gaps.push({ name: d.name, pillar: p.name, score: s, gap: round1(4 - s), weight: p.weight })
    }
  }
  gaps.sort((a, b) => b.gap * b.weight - a.gap * a.weight)
  const critical = gaps.filter((g) => g.gap >= 2)
  const moderate = gaps.filter((g) => g.gap > 0 && g.gap < 2)

  // viability buckets (dimension level)
  const ready: string[] = [], nearReady: string[] = [], needsWork: string[] = []
  for (const p of PILLARS) {
    for (const d of p.dimensions) {
      const s = scores[scoreKey(p.key, d.key)] || 0
      if (s >= 4) ready.push(d.name)
      else if (s >= 2.5) nearReady.push(d.name)
      else if (s > 0) needsWork.push(d.name)
    }
  }

  return {
    pillarResults, overallScore, overallLevel, readiness, ppAvg, tdAvg, algoAvg,
    qX, qY, qName, stdDev, highVariance, bottleneckPillar,
    critical, moderate, ready, nearReady, needsWork,
    scoredCount: Object.values(scores).filter((s) => s > 0).length,
    totalDims: totalDims(),
    useConsolidated,
  }
}

export function computePriorities(scores: ScoreMap, library: Library = LIBRARY): PriorityItem[] {
  const items: PriorityItem[] = []
  for (const pillar of PILLARS) {
    for (const dim of pillar.dimensions) {
      const score = scores[scoreKey(pillar.key, dim.key)] || 0
      if (!score) continue
      const gap = Math.max(0, 4.0 - score)
      const priorityScore = round1(gap * pillar.weight * 100)
      const phase = getPhaseIndex(score)
      const lib = library[pillar.key]?.[dim.key]
      if (!lib) continue
      const act = lib[phase] || lib[lib.length - 1]
      items.push({
        pillarKey: pillar.key, pillarName: pillar.name, pillarWeight: pillar.weight,
        dimKey: dim.key, dimName: dim.name,
        score: round1(score), gap: round1(gap), phase, priorityScore,
        activity: act.activity, type: act.type,
      })
    }
  }
  items.sort((a, b) => b.priorityScore - a.priorityScore)
  return items
}

/** Top 7 priorities form the 30-day sprint (artifact behavior). */
export const sprintItems = (priorities: PriorityItem[]) => priorities.slice(0, 7)

export const phaseItems = (priorities: PriorityItem[], phase: number) =>
  priorities.filter((p) => p.phase === phase)
