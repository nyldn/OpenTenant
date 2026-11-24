import { LEVEL_NAMES } from "./constants"
import { PILLARS } from "./data/pillars"
import { scoreKey } from "./engine"
import { ASSESSMENT_VERSION, getAssessmentRuntimeConfig } from "./runtime"
import type { ClientInfo } from "./store"
import type {
  DashboardResult,
  EvidenceMap,
  PriorityItem,
  Respondent,
  ScoreMap,
} from "./types"
import type { EngagementDocument } from "./persistence/engagement-schema"

function dateStamp(date: Date) {
  return `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
}

export function assessmentExportName(
  clientName: string,
  extension: "csv" | "json",
  date = new Date(),
) {
  const safeClient = (clientName || "assessment").trim().replace(/\s+/g, "_")
  const suffix = getAssessmentRuntimeConfig().exportSuffix
  return `${dateStamp(date)}_Assessment_${safeClient}_${ASSESSMENT_VERSION}_${suffix}.${extension}`
}

export function assessmentEngagementExportName(clientName: string, date = new Date()) {
  const safeClient = (clientName || "assessment").trim().replace(/\s+/g, "_")
  const suffix = getAssessmentRuntimeConfig().exportSuffix
  return `${dateStamp(date)}_Assessment_${safeClient}_${ASSESSMENT_VERSION}_${suffix}_engagement-v2.json`
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

export function buildAssessmentCsv(resolved: ScoreMap, evidence: EvidenceMap) {
  const rows: Array<Array<string | number>> = [["Pillar", "Dimension", "Score", "Level", "Evidence"]]
  for (const pillar of PILLARS) {
    for (const dimension of pillar.dimensions) {
      const id = scoreKey(pillar.key, dimension.key)
      const score = resolved[id] || 0
      rows.push([
        pillar.name,
        dimension.name,
        score || "",
        score ? LEVEL_NAMES[Math.round(score)] : "",
        evidence[id] || "",
      ])
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n")
}

export function buildAssessmentJson(
  clientInfo: ClientInfo,
  dashboard: DashboardResult,
  priorities: PriorityItem[],
  respondents: Respondent[],
) {
  return JSON.stringify({ clientInfo, dashboard, priorities, respondents }, null, 2)
}

export function downloadText(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadAssessmentCsv(
  clientName: string,
  resolved: ScoreMap,
  evidence: EvidenceMap,
) {
  downloadText(
    assessmentExportName(clientName, "csv"),
    buildAssessmentCsv(resolved, evidence),
    "text/csv;charset=utf-8",
  )
}

export function downloadAssessmentJson(
  clientInfo: ClientInfo,
  dashboard: DashboardResult,
  priorities: PriorityItem[],
  respondents: Respondent[],
) {
  downloadText(
    assessmentExportName(clientInfo.name, "json"),
    buildAssessmentJson(clientInfo, dashboard, priorities, respondents),
    "application/json",
  )
}

export function buildAssessmentEngagementJson(document: EngagementDocument): string {
  return JSON.stringify(document, null, 2)
}

export function downloadAssessmentEngagement(document: EngagementDocument) {
  downloadText(assessmentEngagementExportName(document.session.clientInfo.name), buildAssessmentEngagementJson(document), "application/json")
}
