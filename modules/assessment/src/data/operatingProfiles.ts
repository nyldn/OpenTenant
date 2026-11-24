/** Synthetic operating profiles used only to demonstrate contextual prompts. */
export const OPERATING_PROFILES = [
  { value: "professional_services", label: "Professional services" },
  { value: "financial_services", label: "Financial services" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "public_sector", label: "Public sector" },
] as const

export type OperatingProfile = typeof OPERATING_PROFILES[number]["value"]

const OVERVIEW_QUESTIONS = [
  "Which business outcomes should AI improve during the next twelve months?",
  "Who owns the AI portfolio and the decisions to fund, pause, or stop work?",
  "How are opportunities compared across value, feasibility, risk, and time to impact?",
  "Which measures establish the current baseline and prove that value was realised?",
  "How will successful experiments become supported, repeatable operating capabilities?",
] as const

const PROFILE_WORKFLOWS: Record<OperatingProfile, readonly string[]> = {
  professional_services: [
    "lead qualification and proposal development",
    "engagement planning and staffing",
    "knowledge discovery and reuse",
    "delivery quality assurance",
    "client reporting and renewal",
  ],
  financial_services: [
    "customer onboarding and verification",
    "transaction monitoring and review",
    "credit or risk decision support",
    "regulatory evidence preparation",
    "customer service and complaint handling",
  ],
  manufacturing: [
    "demand planning and scheduling",
    "supplier and inventory management",
    "production quality inspection",
    "asset maintenance and reliability",
    "distribution and order fulfilment",
  ],
  public_sector: [
    "service request intake and triage",
    "eligibility or case assessment",
    "work allocation and escalation",
    "records management and disclosure",
    "outcome reporting and service improvement",
  ],
}

function categoryQuestions(profile: OperatingProfile) {
  const workflows = PROFILE_WORKFLOWS[profile]
  return {
    overview: [...OVERVIEW_QUESTIONS],
    process: workflows.map((workflow) =>
      `How is ${workflow} performed today, and where do delay, rework, or exceptions occur?`,
    ),
    systems: workflows.map((workflow) =>
      `Which systems and data support ${workflow}, and where are access, quality, or integration gaps?`,
    ),
    people: workflows.map((workflow) =>
      `Who is accountable for ${workflow}, and what skills, capacity, or adoption constraints exist?`,
    ),
  }
}

export function operatingProfileQuestionTips(
  profile: OperatingProfile,
  pillarKey: string,
  dimensionIndex: number,
): string[] {
  const questions = categoryQuestions(profile)
  const category = pillarKey === "strategy"
    ? questions.overview
    : pillarKey === "business_processes_governance"
      ? questions.process
      : pillarKey === "org_culture_talent"
        ? questions.people
        : questions.systems
  return [category[dimensionIndex % category.length]!]
}

export function operatingProfileQuestionCount(): number {
  return OPERATING_PROFILES.reduce((total, profile) => {
    const questions = categoryQuestions(profile.value)
    return total + questions.overview.length + questions.process.length + questions.systems.length + questions.people.length
  }, 0)
}
