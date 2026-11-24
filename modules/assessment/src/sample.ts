// Synthetic, realistic data for Demo Mode and the "Load sample" path. Used
// only in memory (Demo Mode never persists), so toggling it never touches a
// real session. Mid-maturity enterprise profile with spread across pillars.
import type { ScoreMap, Respondent } from "./types"
import { scoreKey } from "./engine"
import type { ClientInfo } from "./store"
import { createRespondentId } from "./respondents"

const PATTERN: Record<string, Record<string, number>> = {
  strategy: { ai_vision: 3, leadership_commitment: 4, use_case_prioritization: 3, roi_framework: 2, competitive_positioning: 3 },
  business_processes_governance: { process_documentation: 3, process_automation: 2, ai_governance: 2, regulatory_compliance: 3, continuous_improvement: 3 },
  data_infrastructure: { data_quality: 2, data_accessibility: 3, infrastructure_readiness: 3, data_privacy_security: 4, data_strategy_monetization: 2 },
  technology_tools: { tech_stack: 3, integration_architecture: 3, vendor_management: 4, mlops_maturity: 2, technical_debt: 2 },
  org_culture_talent: { change_readiness: 3, org_structure_governance: 2, skills_literacy: 2, talent_strategy: 3, ai_ethics: 4 },
}

function patternToScores(adjust: (pillar: string, dim: string, v: number) => number): ScoreMap {
  const m: ScoreMap = {}
  for (const [pk, dims] of Object.entries(PATTERN)) {
    for (const [dk, v] of Object.entries(dims)) {
      const adj = Math.max(1, Math.min(5, adjust(pk, dk, v)))
      m[scoreKey(pk, dk)] = adj
    }
  }
  return m
}

export const SAMPLE_CLIENT: ClientInfo = {
  name: "Northwind Logistics",
  department: "Operations & Technology",
  operatingProfile: "professional_services",
  date: "",
  facilitator: "OpenTenant facilitator",
}

export function makeSampleScores(): ScoreMap {
  return patternToScores((_p, _d, v) => v)
}

// Two respondents with mild divergence so the consolidation view is realistic.
export function makeSampleRespondents(): Respondent[] {
  const ts = "2026-06-30T12:00:00.000Z"
  return [
    {
      id: createRespondentId(SAMPLE_CLIENT.name, SAMPLE_CLIENT.department, "J. Okafor"),
      company: SAMPLE_CLIENT.name, department: SAMPLE_CLIENT.department, operatingProfile: SAMPLE_CLIENT.operatingProfile,
      name: "J. Okafor", role: "CIO", timestamp: ts,
      scores: patternToScores((p, _d, v) => (p === "technology_tools" || p === "data_infrastructure" ? v + 1 : v)),
      evidence: {},
    },
    {
      id: createRespondentId(SAMPLE_CLIENT.name, SAMPLE_CLIENT.department, "M. Reyes"),
      company: SAMPLE_CLIENT.name, department: SAMPLE_CLIENT.department, operatingProfile: SAMPLE_CLIENT.operatingProfile,
      name: "M. Reyes", role: "COO", timestamp: ts,
      scores: patternToScores((p, _d, v) => (p === "business_processes_governance" || p === "org_culture_talent" ? v - 1 : v)),
      evidence: {},
    },
  ]
}
