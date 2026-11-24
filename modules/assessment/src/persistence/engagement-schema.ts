/** The versioned, tenant-bound Assessment engagement document. */
import { PILLARS } from "../data/pillars"
import type { EvidenceMap, Respondent, ScoreMap } from "../types"
import type { AssessmentSession } from "../store"

export const ENGAGEMENT_SCHEMA_VERSION = 2 as const
export const MAX_SERIALIZED_BYTES = 1024 * 1024
export const MAX_RESPONDENTS = 500
export const MAX_TEXT = 256
export const MAX_EVIDENCE = 8192
export const MAX_READOUT = 131072
export const MAX_ID = 128
export const MAX_VALIDATION_ERRORS = 64
export const MAX_RESPONDENT_ID = 10240
export const DIMENSION_KEYS = new Set(PILLARS.flatMap((pillar) => pillar.dimensions.map((dimension) => `${pillar.key}__${dimension.key}`)))
export const OPERATING_PROFILE_VALUES = new Set(["", "professional_services", "financial_services", "manufacturing", "public_sector"])

export interface EngagementClientInfo { name: string; department: string; operatingProfile: "" | "professional_services" | "financial_services" | "manufacturing" | "public_sector"; date: string; facilitator: string }
export interface EngagementRespondent { id: string; company: string; department: string; operatingProfile: EngagementClientInfo["operatingProfile"]; name: string; role: string; timestamp: string; scores: ScoreMap; evidence: EvidenceMap }
export interface LegacyClaim { claimId: string; source: "v26" | "engagement_v1"; sourceDigests: { assessment_session_v26: string | null; assessment_respondents_v26: string | null; assessment_engagement_v1: string | null } }
export interface EngagementReadout { text: string; generatedAt: string | null; inputDigest: string | null }
export interface EngagementDocument { schemaVersion: 2; appVersion: string; tenantId: string; engagementId: string; brandLabel: string | null; session: { clientInfo: EngagementClientInfo; scores: ScoreMap; evidence: EvidenceMap; currentPillar: number }; respondents: EngagementRespondent[]; legacyClaim: LegacyClaim | null; readout: EngagementReadout | null; createdAt: string; updatedAt: string }
export interface LegacyClaimReceipt { schemaVersion: 1; claimId: string; tenantId: string; source: "v26" | "engagement_v1"; sourceDigests: LegacyClaim["sourceDigests"]; status: "pending" | "complete"; targetDocumentDigest: string | null; createdAt: string; updatedAt: string }
export type ValidationResult = { ok: true; document: EngagementDocument } | { ok: false; errors: string[] }
export type ReceiptValidationResult = { ok: true; receipt: LegacyClaimReceipt } | { ok: false; errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
const boundedString = (value: unknown, max: number) => typeof value === "string" && Array.from(value).length <= max
const isoUtc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
const mapOwn = (value: unknown): value is Record<string, unknown> => isRecord(value)

function validateMap(value: unknown, kind: "score" | "evidence", errors: string[], label: string) {
  if (!mapOwn(value)) { errors.push(`${label} is not a map`); return }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) errors.push(`${label} has an invalid prototype`)
  for (const key of Object.keys(value)) {
    if (!DIMENSION_KEYS.has(key)) { errors.push(`${label} has an unsupported dimension`); continue }
    const entry = value[key]
    if (kind === "score" && (!Number.isInteger(entry) || (entry as number) < 1 || (entry as number) > 5)) errors.push(`${label}.${key} is not an integer score from 1 through 5`)
    if (kind === "evidence" && !boundedString(entry, MAX_EVIDENCE)) errors.push(`${label}.${key} is too long or not a string`)
  }
}
function validateClient(value: unknown, errors: string[], label: string) {
  if (!isRecord(value) || !exactKeys(value, ["name", "department", "operatingProfile", "date", "facilitator"])) { errors.push(`${label} has unexpected or missing fields`); return }
  if (!boundedString(value.name, MAX_TEXT)) errors.push(`${label}.name is invalid`)
  if (!boundedString(value.department, MAX_TEXT)) errors.push(`${label}.department is invalid`)
  if (typeof value.operatingProfile !== "string" || !OPERATING_PROFILE_VALUES.has(value.operatingProfile)) errors.push(`${label}.operatingProfile is invalid`)
  if (typeof value.date !== "string" || (value.date !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(Date.parse(`${value.date}T00:00:00.000Z`)) || new Date(`${value.date}T00:00:00.000Z`).toISOString().slice(0, 10) !== value.date))) errors.push(`${label}.date is invalid`)
  if (!boundedString(value.facilitator, MAX_TEXT)) errors.push(`${label}.facilitator is invalid`)
}
function validateClaim(value: unknown, errors: string[], label: string) {
  if (value === null) return
  if (!isRecord(value) || !exactKeys(value, ["claimId", "source", "sourceDigests"])) { errors.push(`${label} is invalid`); return }
  if (!boundedString(value.claimId, MAX_ID) || (typeof value.claimId === "string" && value.claimId.length === 0)) errors.push(`${label}.claimId is invalid`)
  if (value.source !== "v26" && value.source !== "engagement_v1") errors.push(`${label}.source is invalid`)
  if (!isRecord(value.sourceDigests) || !exactKeys(value.sourceDigests, ["assessment_session_v26", "assessment_respondents_v26", "assessment_engagement_v1"])) { errors.push(`${label}.sourceDigests is invalid`); return }
  for (const key of ["assessment_session_v26", "assessment_respondents_v26", "assessment_engagement_v1"] as const) if (value.sourceDigests[key] !== null && !digest(value.sourceDigests[key])) errors.push(`${label}.sourceDigests.${key} is invalid`)
  if (value.source === "v26" && value.sourceDigests.assessment_session_v26 === null && value.sourceDigests.assessment_respondents_v26 === null) errors.push(`${label}.sourceDigests is empty`)
  if (value.source === "engagement_v1" && value.sourceDigests.assessment_engagement_v1 === null) errors.push(`${label}.sourceDigests is empty`)
}

export function validateEngagementDocument(input: unknown, trustedTenantId?: string): ValidationResult {
  const errors: string[] = []
  if (!isRecord(input) || !exactKeys(input, ["schemaVersion", "appVersion", "tenantId", "engagementId", "brandLabel", "session", "respondents", "legacyClaim", "readout", "createdAt", "updatedAt"])) return { ok: false, errors: ["document has unexpected or missing fields"] }
  const doc = input
  if (doc.schemaVersion !== 2) errors.push("schemaVersion must be 2")
  if (typeof doc.appVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(doc.appVersion)) errors.push("appVersion is invalid")
  if (!boundedString(doc.tenantId, MAX_ID) || (typeof doc.tenantId === "string" && doc.tenantId.length === 0) || (trustedTenantId !== undefined && doc.tenantId !== trustedTenantId)) errors.push("tenantId is invalid or does not match trusted tenant")
  if (!boundedString(doc.engagementId, MAX_ID) || (typeof doc.engagementId === "string" && doc.engagementId.length === 0)) errors.push("engagementId is invalid")
  if (doc.brandLabel !== null && !boundedString(doc.brandLabel, MAX_TEXT)) errors.push("brandLabel is invalid")
  if (!isRecord(doc.session) || !exactKeys(doc.session, ["clientInfo", "scores", "evidence", "currentPillar"])) errors.push("session is invalid")
  else { validateClient(doc.session.clientInfo, errors, "session.clientInfo"); validateMap(doc.session.scores, "score", errors, "session.scores"); validateMap(doc.session.evidence, "evidence", errors, "session.evidence"); const currentPillar = doc.session.currentPillar; if (!Number.isInteger(currentPillar) || (currentPillar as number) < 0 || (currentPillar as number) > PILLARS.length + 1) errors.push("session.currentPillar is invalid") }
  if (!Array.isArray(doc.respondents) || doc.respondents.length > MAX_RESPONDENTS) errors.push("respondents is invalid")
  else {
    const ids = new Set<string>()
    doc.respondents.forEach((entry, index) => {
      if (!isRecord(entry) || !exactKeys(entry, ["id", "company", "department", "operatingProfile", "name", "role", "timestamp", "scores", "evidence"])) { errors.push(`respondent[${index}] is invalid`); return }
      if (!boundedString(entry.id, MAX_RESPONDENT_ID) || (typeof entry.id === "string" && entry.id.length === 0)) errors.push(`respondent[${index}].id is invalid`)
      if (typeof entry.id === "string" && ids.has(entry.id)) errors.push(`respondent[${index}] has duplicate id`); if (typeof entry.id === "string") ids.add(entry.id)
      for (const field of ["company", "department", "role"] as const) if (!boundedString(entry[field], MAX_TEXT)) errors.push(`respondent[${index}].${field} is invalid`)
      if (typeof entry.name !== "string" || !boundedString(entry.name, MAX_TEXT) || !/\S/u.test(entry.name)) errors.push(`respondent[${index}].name is invalid`)
      if (typeof entry.operatingProfile !== "string" || !OPERATING_PROFILE_VALUES.has(entry.operatingProfile)) errors.push(`respondent[${index}].operatingProfile is invalid`)
      if (!isoUtc(entry.timestamp)) errors.push(`respondent[${index}].timestamp is invalid`)
      validateMap(entry.scores, "score", errors, `respondent[${index}].scores`); validateMap(entry.evidence, "evidence", errors, `respondent[${index}].evidence`)
    })
  }
  validateClaim(doc.legacyClaim, errors, "legacyClaim")
  if (doc.readout !== null) {
    if (!isRecord(doc.readout) || !exactKeys(doc.readout, ["text", "generatedAt", "inputDigest"])) errors.push("readout is invalid")
    else { if (typeof doc.readout.text !== "string" || doc.readout.text.length === 0 || !boundedString(doc.readout.text, MAX_READOUT)) errors.push("readout.text is invalid"); const unbound = doc.readout.generatedAt === null && doc.readout.inputDigest === null; const bound = isoUtc(doc.readout.generatedAt) && digest(doc.readout.inputDigest); if (!unbound && !bound) errors.push("readout binding is invalid") }
  }
  if (!isoUtc(doc.createdAt) || !isoUtc(doc.updatedAt) || (isoUtc(doc.createdAt) && isoUtc(doc.updatedAt) && doc.createdAt > doc.updatedAt)) errors.push("document timestamps are invalid")
  if (errors.length) return { ok: false, errors: errors.slice(0, MAX_VALIDATION_ERRORS) }
  return { ok: true, document: structuredClone(input) as unknown as EngagementDocument }
}
export function validateSerializedDocument(raw: string, trustedTenantId?: string): ValidationResult { if (new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES) return { ok: false, errors: ["document exceeds 1 MiB"] }; try { return validateEngagementDocument(JSON.parse(raw) as unknown, trustedTenantId) } catch { return { ok: false, errors: ["document is not valid JSON"] } } }
export function validateLegacyClaimReceipt(input: unknown, trustedTenantId?: string): ReceiptValidationResult {
  const errors: string[] = []
  if (!isRecord(input) || !exactKeys(input, ["schemaVersion", "claimId", "tenantId", "source", "sourceDigests", "status", "targetDocumentDigest", "createdAt", "updatedAt"])) return { ok: false, errors: ["legacy claim receipt is invalid"] }
  if (input.schemaVersion !== 1 || !boundedString(input.claimId, MAX_ID) || (typeof input.claimId === "string" && input.claimId.length === 0) || !boundedString(input.tenantId, MAX_ID) || (typeof input.tenantId === "string" && input.tenantId.length === 0) || (trustedTenantId !== undefined && input.tenantId !== trustedTenantId)) errors.push("legacy claim identity is invalid")
  if (input.source !== "v26" && input.source !== "engagement_v1") errors.push("legacy claim source is invalid")
  if (!isRecord(input.sourceDigests) || !exactKeys(input.sourceDigests, ["assessment_session_v26", "assessment_respondents_v26", "assessment_engagement_v1"])) errors.push("legacy claim digests are invalid")
  else {
    for (const key of ["assessment_session_v26", "assessment_respondents_v26", "assessment_engagement_v1"] as const) if (input.sourceDigests[key] !== null && !digest(input.sourceDigests[key])) errors.push(`legacy claim digest ${key} is invalid`)
    if (input.source === "v26" && input.sourceDigests.assessment_session_v26 === null && input.sourceDigests.assessment_respondents_v26 === null) errors.push("v26 claim needs a source digest")
    if (input.source === "engagement_v1" && input.sourceDigests.assessment_engagement_v1 === null) errors.push("engagement_v1 claim needs a source digest")
  }
  if (input.status !== "pending" && input.status !== "complete") errors.push("legacy claim status is invalid")
  if (input.targetDocumentDigest !== null && !digest(input.targetDocumentDigest)) errors.push("legacy claim target digest is invalid")
  if (input.status === "complete" && input.targetDocumentDigest === null) errors.push("complete claim needs target digest")
  if (!isoUtc(input.createdAt) || !isoUtc(input.updatedAt) || (isoUtc(input.createdAt) && isoUtc(input.updatedAt) && input.createdAt > input.updatedAt)) errors.push("legacy claim timestamps are invalid")
  if (errors.length) return { ok: false, errors: errors.slice(0, MAX_VALIDATION_ERRORS) }; return { ok: true, receipt: structuredClone(input) as unknown as LegacyClaimReceipt }
}
export function engagementFromSession(args: { tenantId: string; brandLabel?: string | null; session: AssessmentSession; respondents: Respondent[]; appVersion: string; engagementId?: string; createdAt?: string; updatedAt?: string; legacyClaim?: LegacyClaim | null; readout?: EngagementReadout | null }): EngagementDocument {
  const now = args.updatedAt ?? new Date().toISOString()
  return { schemaVersion: 2, appVersion: args.appVersion, tenantId: args.tenantId, engagementId: args.engagementId ?? `eng_${crypto.randomUUID()}`, brandLabel: args.brandLabel ?? null, session: { clientInfo: { ...args.session.clientInfo, operatingProfile: OPERATING_PROFILE_VALUES.has(args.session.clientInfo.operatingProfile) ? args.session.clientInfo.operatingProfile as EngagementClientInfo["operatingProfile"] : "" }, scores: { ...args.session.scores }, evidence: { ...args.session.evidence }, currentPillar: args.session.currentPillar }, respondents: args.respondents.map((respondent) => ({ id: respondent.id, company: respondent.company ?? "", department: respondent.department ?? "", operatingProfile: OPERATING_PROFILE_VALUES.has(respondent.operatingProfile ?? "") ? respondent.operatingProfile as EngagementClientInfo["operatingProfile"] : "", name: respondent.name, role: respondent.role, timestamp: respondent.timestamp, scores: { ...respondent.scores }, evidence: { ...respondent.evidence } })), legacyClaim: args.legacyClaim ?? null, readout: args.readout ?? null, createdAt: args.createdAt ?? now, updatedAt: now }
}
