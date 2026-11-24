import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")

describe("Assessment UI module contract", () => {
  it("keeps AssessmentApp as a small coordinator over focused modules", () => {
    const coordinator = source("./AssessmentApp.tsx")
    expect(coordinator.split("\n").length).toBeLessThan(250)
    for (const moduleName of [
      "assessment-shell.tsx",
      "assessment-questionnaire.tsx",
      "assessment-responses.tsx",
      "assessment-results.tsx",
      "assessment-exports.ts",
    ]) {
      expect(() => source(`./${moduleName}`)).not.toThrow()
    }
  })

  it("keeps one demo banner, accessible progress, tabbed responses, and one export cluster", () => {
    const shell = source("./assessment-shell.tsx")
    const responses = source("./assessment-responses.tsx")
    const results = source("./assessment-results.tsx")

    expect(shell.match(/Demo mode is on\./g)).toHaveLength(1)
    expect(shell).not.toContain(">Demo data</Badge>")
    expect(shell).toContain('aria-label="Assessment completion"')
    expect(responses).toContain('<TabsTrigger value="roster">Respondent roster</TabsTrigger>')
    expect(responses).toContain('<TabsTrigger value="matrix">Score matrix</TabsTrigger>')
    expect(responses).toContain("This cannot be undone.")
    expect(results.match(/>Download PDF</g)).toHaveLength(1)
    expect(results).toContain("Export data")
    expect(results).toContain("Export CSV")
    expect(results).toContain("Export JSON")
  })

  it("allows assessment controls and result panels to shrink on narrow screens", () => {
    const shell = source("./assessment-shell.tsx")
    const primitives = source("./assessment-primitives.tsx")
    const charts = source("./components/charts.tsx")

    expect(shell).toContain('className="flex flex-wrap items-center gap-1.5"')
    expect(primitives).toContain('cn("min-w-0 rounded-lg')
    expect(charts).toContain('className="h-[340px] min-w-0 w-full overflow-hidden"')
  })
})
