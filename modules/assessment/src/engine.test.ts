import { describe, it, expect } from "vitest"
import { PILLARS } from "./data/pillars"
import {
  scoreKey, totalDims, resolveScores, computePillarResults, getPhaseIndex,
  computeDashboard, computePriorities, sprintItems,
} from "./engine"
import type { ScoreMap, Respondent } from "./types"

// helpers
const allScores = (v: number): ScoreMap => {
  const m: ScoreMap = {}
  for (const p of PILLARS) for (const d of p.dimensions) m[scoreKey(p.key, d.key)] = v
  return m
}
const pillarDimKeys = (pk: string) => PILLARS.find((p) => p.key === pk)!.dimensions.map((d) => d.key)

describe("structure", () => {
  it("has 5 pillars, 25 dimensions, weights summing to 1.0", () => {
    expect(PILLARS).toHaveLength(5)
    expect(totalDims()).toBe(25)
    expect(PILLARS.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1.0, 6)
  })
})

describe("getPhaseIndex boundaries", () => {
  it("buckets on <=2, <=3, <=4, else", () => {
    expect(getPhaseIndex(1)).toBe(0)
    expect(getPhaseIndex(2.0)).toBe(0)
    expect(getPhaseIndex(2.01)).toBe(1)
    expect(getPhaseIndex(3.0)).toBe(1)
    expect(getPhaseIndex(3.01)).toBe(2)
    expect(getPhaseIndex(4.0)).toBe(2)
    expect(getPhaseIndex(4.01)).toBe(3)
    expect(getPhaseIndex(5)).toBe(3)
  })
})

describe("pillar averages exclude unanswered", () => {
  it("averages only scored dimensions", () => {
    const m: ScoreMap = {}
    const [d0, d1] = pillarDimKeys("strategy")
    m[scoreKey("strategy", d0)] = 5
    m[scoreKey("strategy", d1)] = 1
    const pr = computePillarResults(m).find((p) => p.key === "strategy")!
    expect(pr.avg).toBe(3) // (5+1)/2, unanswered excluded
    expect(pr.coverage).toBeCloseTo(2 / 5)
  })
})

describe("dashboard: empty assessment", () => {
  it("does not fabricate a non-zero readiness when nothing is scored", () => {
    const d = computeDashboard({})
    expect(d.overallScore).toBe(0)
    expect(d.ppAvg).toBe(0); expect(d.tdAvg).toBe(0)
    expect(d.algoAvg).toBe(0) // no |5 fallback on a wholly empty assessment
    expect(d.readiness).toBe(0)
  })
})

describe("dashboard: uniform 3s", () => {
  const d = computeDashboard(allScores(3))
  it("overall is 3.0, level 3", () => {
    expect(d.overallScore).toBe(3)
    expect(d.overallLevel).toBe(3)
  })
  it("70-20-10 readiness is 3.0", () => {
    expect(d.ppAvg).toBe(3)
    expect(d.tdAvg).toBe(3)
    expect(d.algoAvg).toBe(3)
    expect(d.readiness).toBe(3)
  })
  it("quadrant is Scale & Lead at (3,3)", () => {
    expect(d.qX).toBe(3); expect(d.qY).toBe(3); expect(d.qName).toBe("Scale & Lead")
  })
  it("variance zero, no bottleneck", () => {
    expect(d.stdDev).toBe(0); expect(d.highVariance).toBe(false); expect(d.bottleneckPillar).toBeNull()
  })
  it("all 25 dims are moderate gaps (gap 1.0), none critical", () => {
    expect(d.critical).toHaveLength(0)
    expect(d.moderate).toHaveLength(25)
    expect(d.moderate[0].gap).toBe(1)
  })
  it("all dims near-ready (>=2.5, <4)", () => {
    expect(d.nearReady).toHaveLength(25)
    expect(d.ready).toHaveLength(0)
    expect(d.needsWork).toHaveLength(0)
  })
})

describe("dashboard: partial strategy-only assessment", () => {
  const m: ScoreMap = {}
  const dims = pillarDimKeys("strategy")
  m[scoreKey("strategy", dims[0])] = 5 // ai_vision
  m[scoreKey("strategy", dims[1])] = 1 // leadership
  const d = computeDashboard(m)
  it("overall reflects only the pillar with data", () => {
    expect(d.overallScore).toBe(3) // strategy.avg 3.0, weight isolated
    expect(d.overallLevel).toBe(3)
  })
  it("readiness uses min() proxy and 0 tech/data", () => {
    expect(d.ppAvg).toBe(3); expect(d.tdAvg).toBe(0)
    expect(d.algoAvg).toBe(3) // min(3, 5-fallback)
    expect(d.readiness).toBe(2.4) // 0.7*3 + 0.2*0 + 0.1*3
  })
  it("quadrant is Aspiration Gap (x<2.5, y>=2.5)", () => {
    expect(d.qName).toBe("Aspiration Gap")
  })
  it("gap + viability split the two scored dims", () => {
    expect(d.critical.map((g) => g.score)).toEqual([1]) // gap 3.0 >= 2
    expect(d.ready).toContain(PILLARS[0].dimensions[0].name) // score 5
    expect(d.needsWork).toContain(PILLARS[0].dimensions[1].name) // score 1
  })
})

describe("variance flag and bottleneck", () => {
  it("flags high variance and names the lowest pillar", () => {
    const m: ScoreMap = {}
    // strategy 5s, everything else 1s -> wide spread
    for (const p of PILLARS) for (const d of p.dimensions) m[scoreKey(p.key, d.key)] = p.key === "strategy" ? 5 : 1
    const d = computeDashboard(m)
    expect(d.highVariance).toBe(true)
    expect(d.bottleneckPillar).not.toBe("Strategy")
  })
})

describe("priorities and sprint", () => {
  const priorities = computePriorities(allScores(3))
  it("computes a priorityScore for every scored dimension", () => {
    expect(priorities).toHaveLength(25)
  })
  it("weights priority by pillar weight (data_infra 0.25 outranks org 0.15 at equal gap)", () => {
    const di = priorities.find((p) => p.pillarKey === "data_infrastructure")!
    const oc = priorities.find((p) => p.pillarKey === "org_culture_talent")!
    expect(di.priorityScore).toBe(25) // gap 1.0 * 0.25 * 100
    expect(oc.priorityScore).toBe(15) // gap 1.0 * 0.15 * 100
    expect(priorities[0].priorityScore).toBeGreaterThanOrEqual(priorities[1].priorityScore)
  })
  it("sprint is the top 7", () => {
    expect(sprintItems(priorities)).toHaveLength(7)
  })
  it("score of 3 maps to phase 1 (Activation)", () => {
    expect(priorities[0].phase).toBe(1)
  })
})

describe("multi-respondent consolidation", () => {
  it("resolves per-dimension means across respondents", () => {
    const k = scoreKey("strategy", pillarDimKeys("strategy")[0])
    const respondents: Respondent[] = [
      { id: "a", name: "A", role: "", timestamp: "", scores: { [k]: 2 }, evidence: {} },
      { id: "b", name: "B", role: "", timestamp: "", scores: { [k]: 4 }, evidence: {} },
    ]
    const resolved = resolveScores({}, respondents)
    expect(resolved[k]).toBe(3) // mean(2,4)
  })
  it("falls back to session score when no respondent scored a dimension", () => {
    const k = scoreKey("strategy", pillarDimKeys("strategy")[0])
    const k2 = scoreKey("strategy", pillarDimKeys("strategy")[1])
    const respondents: Respondent[] = [
      { id: "a", name: "A", role: "", timestamp: "", scores: { [k]: 4 }, evidence: {} },
    ]
    const resolved = resolveScores({ [k2]: 2 }, respondents)
    expect(resolved[k]).toBe(4)
    expect(resolved[k2]).toBe(2)
  })
})
