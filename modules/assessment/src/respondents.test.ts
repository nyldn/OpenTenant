import { describe, expect, it } from "vitest"
import { buildAssessmentJson } from "./assessment-exports"
import { SAMPLE_CLIENT } from "./sample"
import type { Respondent } from "./types"
import {
  applyRespondentEdit,
  createRespondentEdit,
  createRespondentId,
  createUniqueRespondentId,
  upsertRespondent,
} from "./respondents"

function respondent(
  company: string,
  department: string,
  name: string,
  timestamp: string,
): Respondent {
  return {
    id: createRespondentId(company, department, name),
    company,
    department,
    name,
    role: "Operations leader",
    timestamp,
    scores: {},
    evidence: {},
  }
}

describe("respondent identity", () => {
  it("keeps the same interviewee name in different departments", () => {
    const commercial = respondent(
      "Acme Insurance",
      "Commercial Lines",
      "Alex Morgan",
      "2026-07-13T10:00:00.000Z",
    )
    const personal = respondent(
      "Acme Insurance",
      "Personal Lines",
      "Alex Morgan",
      "2026-07-13T11:00:00.000Z",
    )

    const saved = upsertRespondent(upsertRespondent([], commercial), personal)

    expect(saved).toHaveLength(2)
    expect(saved.map((item) => item.department)).toEqual([
      "Commercial Lines",
      "Personal Lines",
    ])
  })

  it("updates an existing interviewee only within the same company and department", () => {
    const first = respondent(
      "Acme Insurance",
      "Commercial Lines",
      "Alex Morgan",
      "2026-07-13T10:00:00.000Z",
    )
    const revised = {
      ...respondent(
        " acme insurance ",
        "commercial lines",
        " alex morgan ",
        "2026-07-13T11:00:00.000Z",
      ),
      role: "VP, Operations",
    }

    const saved = upsertRespondent(upsertRespondent([], first), revised)

    expect(saved).toHaveLength(1)
    expect(saved[0].role).toBe("VP, Operations")
    expect(saved[0].timestamp).toBe("2026-07-13T11:00:00.000Z")
  })

  it("upgrades a persisted name-only record on its next save", () => {
    const legacy: Respondent = {
      id: "alex morgan",
      name: "Alex Morgan",
      role: "Operations leader",
      timestamp: "2026-07-12T10:00:00.000Z",
      scores: {},
      evidence: {},
    }
    const scoped = respondent(
      "Acme Insurance",
      "Commercial Lines",
      "Alex Morgan",
      "2026-07-13T10:00:00.000Z",
    )

    const saved = upsertRespondent([legacy], scoped)

    expect(saved).toEqual([scoped])
  })

  it("edits one saved respondent by original id while carrying scores and evidence", () => {
    const original = {
      ...respondent("Acme Insurance", "Commercial Lines", "Alex Morgan", "2026-07-13T10:00:00.000Z"),
      scores: { "people__leadership": 4 },
      evidence: { "people__leadership": "Board-approved roadmap" },
    }
    const edit = createRespondentEdit(original)
    edit.company = "NewCo Insurance"
    edit.department = "Personal Lines"
    edit.name = "Alexandra Morgan"
    edit.role = "VP, Operations"

    const saved = applyRespondentEdit([original], edit, "2026-07-13T11:00:00.000Z")

    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      id: original.id,
      company: "NewCo Insurance",
      department: "Personal Lines",
      name: "Alexandra Morgan",
      role: "VP, Operations",
      scores: original.scores,
      evidence: original.evidence,
      timestamp: "2026-07-13T11:00:00.000Z",
    })

    const reloaded = JSON.parse(JSON.stringify(saved)) as Respondent[]
    const exported = JSON.parse(buildAssessmentJson(SAMPLE_CLIENT, {} as never, [], reloaded)) as { respondents: Respondent[] }
    expect(exported.respondents).toHaveLength(1)
    expect(exported.respondents[0]).toMatchObject({ id: original.id, evidence: original.evidence })
  })

  it("does not create a respondent when an edit target was removed", () => {
    const edit = createRespondentEdit(respondent("Acme Insurance", "Commercial Lines", "Alex Morgan", "2026-07-13T10:00:00.000Z"))

    expect(applyRespondentEdit([], edit, "2026-07-13T11:00:00.000Z")).toEqual([])
  })

  it("does not let a new A overwrite renamed B when the generated A id collides", () => {
    const original = {
      ...respondent("Acme Insurance", "Commercial Lines", "A", "2026-07-13T10:00:00.000Z"),
      scores: { "people__leadership": 2 },
      evidence: { "people__leadership": "A's evidence" },
    }
    const renamedEdit = createRespondentEdit(original)
    renamedEdit.name = "B"
    renamedEdit.scores = { "people__leadership": 5 }
    renamedEdit.evidence = { "people__leadership": "B's evidence" }
    const renamed = applyRespondentEdit([original], renamedEdit, "2026-07-13T11:00:00.000Z")
    const newAId = createUniqueRespondentId(renamed, "Acme Insurance", "Commercial Lines", "A")
    const saved = upsertRespondent(renamed, {
      ...respondent("Acme Insurance", "Commercial Lines", "A", "2026-07-13T12:00:00.000Z"),
      id: newAId,
      scores: { "people__leadership": 3 },
      evidence: { "people__leadership": "New A's evidence" },
    })

    expect(newAId).not.toBe(original.id)
    expect(saved).toHaveLength(2)
    expect(saved.find((item) => item.name === "B")).toMatchObject({
      id: original.id,
      scores: { "people__leadership": 5 },
      evidence: { "people__leadership": "B's evidence" },
    })
    expect(saved.find((item) => item.name === "A")).toMatchObject({
      id: newAId,
      scores: { "people__leadership": 3 },
      evidence: { "people__leadership": "New A's evidence" },
    })
  })

  it("matches a new B to the renamed record without replacing its stable id", () => {
    const original = {
      ...respondent("Acme Insurance", "Commercial Lines", "A", "2026-07-13T10:00:00.000Z"),
      scores: { "people__leadership": 2 },
      evidence: { "people__leadership": "A's evidence" },
    }
    const renamedEdit = createRespondentEdit(original)
    renamedEdit.name = "B"
    renamedEdit.scores = { "people__leadership": 5 }
    renamedEdit.evidence = { "people__leadership": "B's evidence" }
    const renamed = applyRespondentEdit([original], renamedEdit, "2026-07-13T11:00:00.000Z")
    const newB = {
      ...respondent("Acme Insurance", "Commercial Lines", "B", "2026-07-13T12:00:00.000Z"),
      scores: { "people__leadership": 4 },
      evidence: { "people__leadership": "Latest B evidence" },
    }
    const saved = upsertRespondent(renamed, newB)

    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      id: original.id,
      name: "B",
      scores: { "people__leadership": 4 },
      evidence: { "people__leadership": "Latest B evidence" },
    })
  })
})
