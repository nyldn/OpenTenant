import { describe, expect, it } from "vitest"
import {
  assessmentExportName,
  buildAssessmentCsv,
  buildAssessmentJson,
} from "./assessment-exports"
import { PILLARS } from "./data/pillars"
import { computeDashboard, computePriorities, scoreKey } from "./engine"
import { SAMPLE_CLIENT, makeSampleRespondents, makeSampleScores } from "./sample"

describe("Assessment data exports", () => {
  it("builds a complete escaped CSV from resolved scores and evidence", () => {
    const scores = makeSampleScores()
    const first = PILLARS[0].dimensions[0]
    const evidence = {
      [scoreKey(PILLARS[0].key, first.key)]: 'Board-approved, "funded" roadmap',
    }

    const csv = buildAssessmentCsv(scores, evidence)

    expect(csv.split("\n")).toHaveLength(26)
    expect(csv).toContain('"Pillar","Dimension","Score","Level","Evidence"')
    expect(csv).toContain('"Board-approved, ""funded"" roadmap"')
  })

  it("builds valid JSON and deterministic branded filenames", () => {
    const scores = makeSampleScores()
    const respondents = makeSampleRespondents()
    const dashboard = computeDashboard(scores, true)
    const priorities = computePriorities(scores)

    const json = JSON.parse(
      buildAssessmentJson(SAMPLE_CLIENT, dashboard, priorities, respondents),
    ) as {
      clientInfo: { name: string }
      respondents: unknown[]
      priorities: unknown[]
    }

    expect(json.clientInfo.name).toBe("Northwind Logistics")
    expect(json.respondents).toHaveLength(2)
    expect(json.priorities.length).toBeGreaterThan(0)
    expect(
      assessmentExportName(
        "Northwind Logistics",
        "csv",
        new Date(2026, 7, 7),
      ),
    ).toBe("260807_Assessment_Northwind_Logistics_v1.0.0_assessment.csv")
  })
})
