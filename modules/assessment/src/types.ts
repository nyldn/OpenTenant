// Domain types for the generic AI maturity assessment example.

export type Level = "1" | "2" | "3" | "4" | "5"

export interface Dimension {
  key: string
  name: string
  question: string
  context: string
  probes: string[]
  rubric: Record<Level, string>
}

export interface Pillar {
  key: string
  name: string
  weight: number
  description: string
  dimensions: Dimension[]
}

/** key shape: `${pillarKey}__${dimensionKey}`, value 1-5 */
export type ScoreMap = Record<string, number>
export type EvidenceMap = Record<string, string>

export interface Respondent {
  id: string
  /** Organization and department are optional only for persisted pre-v3.8 records. */
  company?: string
  department?: string
  operatingProfile?: string
  name: string
  role: string
  timestamp: string
  scores: ScoreMap
  evidence: EvidenceMap
}

export interface ActivityEntry {
  activity: string
  type: string
}
/** [pillarKey][dimensionKey] -> 4 phase activities (phase 0-3) */
export type Library = Record<string, Record<string, ActivityEntry[]>>

export interface BenchmarkPillar {
  name: string
  weight: number
  industry_median: number
  high_performer: number
  gap: number
  constraining_dimension: string
  distribution: { l1: number; l2: number; l3: number; l4: number; l5: number }
  key_signals: Record<string, unknown>
  dimensions: string[]
}

export interface Benchmark {
  version: string
  generated: string
  author?: string
  sources: string[]
  method_note: string
  overall_distribution: {
    level_1: number; level_2: number; level_3: number; level_4: number; level_5: number
    median_score: number; high_performer_score: number
  }
  pillars: Record<string, BenchmarkPillar>
  level_definitions: Record<Level, { name: string; mitre_equivalent: string }>
}

// ── Computed result shapes ──────────────────────────────────────────────
export interface PillarResult {
  key: string
  name: string
  weight: number
  avg: number        // 0 when no dimensions scored
  coverage: number   // scored / total dimensions in pillar
}

export interface GapItem {
  name: string
  pillar: string
  score: number
  gap: number
  weight: number
}

export interface DashboardResult {
  pillarResults: PillarResult[]
  overallScore: number
  overallLevel: number
  readiness: number
  ppAvg: number
  tdAvg: number
  algoAvg: number
  qX: number
  qY: number
  qName: string
  stdDev: number
  highVariance: boolean
  bottleneckPillar: string | null
  critical: GapItem[]
  moderate: GapItem[]
  ready: string[]
  nearReady: string[]
  needsWork: string[]
  scoredCount: number
  totalDims: number
  useConsolidated: boolean
}

export interface PriorityItem {
  pillarKey: string
  pillarName: string
  pillarWeight: number
  dimKey: string
  dimName: string
  score: number
  gap: number
  phase: number
  priorityScore: number
  activity: string
  type: string
}
