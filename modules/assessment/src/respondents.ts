import type { EvidenceMap, Respondent, ScoreMap } from "./types"

/** Complete saved-response payload used when opening an existing response for editing. */
export interface RespondentEdit {
  id: string
  company: string
  department: string
  operatingProfile: string
  name: string
  role: string
  scores: ScoreMap
  evidence: EvidenceMap
}

function normalizeIdentityPart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
}

/** Normalized respondent fields used for duplicate matching. */
export function createRespondentMatchKey(company: string, department: string, name: string): string {
  return [company, department, name]
    .map((part) => encodeURIComponent(normalizeIdentityPart(part)))
    .join(":")
}

export function createRespondentId(company: string, department: string, name: string): string {
  return `v2:${createRespondentMatchKey(company, department, name)}`
}

/** Allocate a stable saved-record ID without confusing it with its match key. */
export function createUniqueRespondentId(
  respondents: Respondent[],
  company: string,
  department: string,
  name: string,
): string {
  const base = createRespondentId(company, department, name)
  if (!respondents.some((respondent) => respondent.id === base)) return base

  let suffix = 2
  while (respondents.some((respondent) => respondent.id === `${base}:${suffix}`)) suffix += 1
  return `${base}:${suffix}`
}

export function createRespondentEdit(respondent: Respondent): RespondentEdit {
  return {
    id: respondent.id,
    company: respondent.company ?? "",
    department: respondent.department ?? "",
    operatingProfile: respondent.operatingProfile ?? "",
    name: respondent.name,
    role: respondent.role,
    scores: { ...respondent.scores },
    evidence: { ...respondent.evidence },
  }
}

/** Replace an existing response without deriving a new identity from edited fields. */
export function applyRespondentEdit(
  respondents: Respondent[],
  edit: RespondentEdit,
  timestamp: string,
): Respondent[] {
  const index = respondents.findIndex((respondent) => respondent.id === edit.id)
  if (index < 0) return respondents

  const next = respondents.slice()
  next[index] = {
    ...edit,
    scores: { ...edit.scores },
    evidence: { ...edit.evidence },
    timestamp,
  }
  return next
}

function isLegacyNameOnlyRecord(respondent: Respondent, incoming: Respondent): boolean {
  return !respondent.company
    && !respondent.department
    && normalizeIdentityPart(respondent.name) === normalizeIdentityPart(incoming.name)
}

export function upsertRespondent(respondents: Respondent[], incoming: Respondent): Respondent[] {
  const incomingMatchKey = createRespondentMatchKey(
    incoming.company ?? "",
    incoming.department ?? "",
    incoming.name,
  )
  let index = respondents.findIndex((respondent) => createRespondentMatchKey(
    respondent.company ?? "",
    respondent.department ?? "",
    respondent.name,
  ) === incomingMatchKey)
  let matchedLegacyRecord = false

  // Older Assessment records used only the person's lowercased name as the ID. The
  // first subsequent save upgrades that record to the scoped identity.
  if (index < 0) {
    index = respondents.findIndex((respondent) => isLegacyNameOnlyRecord(respondent, incoming))
    matchedLegacyRecord = index >= 0
  }

  if (index < 0) return [...respondents, incoming]
  const next = respondents.slice()
  // Matching fields identify the logical respondent; the saved ID identifies
  // the record and must survive a new save after an edit renamed the person.
  next[index] = { ...incoming, id: matchedLegacyRecord ? incoming.id : respondents[index].id }
  return next
}
