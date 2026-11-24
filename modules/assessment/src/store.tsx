import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { ScoreMap, EvidenceMap, Respondent } from "./types"
import { scoreKey } from "./engine"
import { SAMPLE_CLIENT, makeSampleScores, makeSampleRespondents } from "./sample"
import { applyRespondentEdit, createUniqueRespondentId, type RespondentEdit, upsertRespondent } from "./respondents"
import { ASSESSMENT_VERSION, getAssessmentRuntimeConfig, getAssessmentTenantId } from "./runtime"
import { PILLARS } from "./data/pillars"
import { BENCHMARK } from "./data/benchmark"
import { LocalAssessmentRepository, STALE_ENGAGEMENT, type AssessmentRepository, type RepositoryLoad, type RepositoryMutation } from "./persistence/assessment-repository"
import { engagementFromSession, type EngagementDocument, type EngagementReadout } from "./persistence/engagement-schema"

export interface ClientInfo { name: string; department: string; operatingProfile: string; date: string; facilitator: string }
export interface AssessmentSession { clientInfo: ClientInfo; scores: ScoreMap; evidence: EvidenceMap; currentPillar: number }
export const emptyAssessmentSession: AssessmentSession = { clientInfo: { name: "", department: "", operatingProfile: "", date: "", facilitator: "" }, scores: {}, evidence: {}, currentPillar: 0 }
export function resetAssessmentSession(): AssessmentSession { return { ...emptyAssessmentSession, clientInfo: { ...emptyAssessmentSession.clientInfo }, scores: {}, evidence: {} } }

export interface ReadoutInput { version: number; benchmarkVersion: string; clientInfo: ClientInfo; scores: Array<[string, number | undefined]>; evidence: Array<[string, string | undefined]>; respondents: Array<{ id: string; company: string; department: string; operatingProfile: string; name: string; role: string; timestamp: string; scores: Array<[string, number | undefined]>; evidence: Array<[string, string | undefined]> }> }
export const READOUT_INPUT_VERSION = 1
export function buildReadoutInput(session: AssessmentSession, respondents: Respondent[]): ReadoutInput {
  const keys = PILLARS.flatMap((pillar) => pillar.dimensions.map((dimension) => scoreKey(pillar.key, dimension.key)))
  const entries = <T,>(map: Record<string, T>) => keys.map((key) => [key, map[key]] as [string, T | undefined])
  return { version: READOUT_INPUT_VERSION, benchmarkVersion: BENCHMARK.version, clientInfo: { ...session.clientInfo }, scores: entries(session.scores), evidence: entries(session.evidence), respondents: respondents.slice().sort((a, b) => a.id.localeCompare(b.id)).map((respondent) => ({ id: respondent.id, company: respondent.company ?? "", department: respondent.department ?? "", operatingProfile: respondent.operatingProfile ?? "", name: respondent.name, role: respondent.role, timestamp: respondent.timestamp, scores: entries(respondent.scores), evidence: entries(respondent.evidence) })) }
}
export async function readoutInputDigest(session: AssessmentSession, respondents: Respondent[]): Promise<string> { const raw = JSON.stringify(buildReadoutInput(session, respondents)); const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)); return `sha256:${Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("")}` }

export class AssessmentPersistenceQueue {
  private tail = Promise.resolve()
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

export interface AssessmentSaveTicket { generation: number; snapshot: string }
export class AssessmentSaveTracker {
  private generation = 0
  private latestSnapshot: string | null
  private _persistedSnapshot: string | null
  constructor(initialSnapshot: string | null = null) { this.latestSnapshot = initialSnapshot; this._persistedSnapshot = initialSnapshot }
  get persistedSnapshot() { return this._persistedSnapshot }
  hydrate(snapshot: string) { this.generation += 1; this.latestSnapshot = snapshot; this._persistedSnapshot = snapshot }
  schedule(snapshot: string): AssessmentSaveTicket | null {
    if (snapshot === this.latestSnapshot) return null
    this.latestSnapshot = snapshot
    return { generation: ++this.generation, snapshot }
  }
  retry(snapshot: string): AssessmentSaveTicket { this.latestSnapshot = snapshot; return { generation: ++this.generation, snapshot } }
  complete(ticket: AssessmentSaveTicket, saved: boolean) {
    if (ticket.generation !== this.generation) return false
    if (saved) this._persistedSnapshot = ticket.snapshot
    return true
  }
}

export class AssessmentPersistenceCoordinator {
  private readonly queue = new AssessmentPersistenceQueue()
  private replacementEpoch = 0
  private engagementId: string | null = null
  constructor(private readonly repository: AssessmentRepository) {}
  get currentRepository() { return this.repository }
  load() { return this.queue.run(async () => { const loaded = await this.repository.load(); if (loaded.status === "ready") this.engagementId = loaded.document.engagementId; return loaded }) }
  save(document: EngagementDocument) {
    const epoch = this.replacementEpoch
    return this.queue.run(async () => {
      if (epoch !== this.replacementEpoch || (this.engagementId !== null && document.engagementId !== this.engagementId)) return { ok: false as const, code: "conflict" as const, errors: ["Assessment state was replaced before save"] }
      const result = await this.repository.save(document)
      if (result.ok) this.engagementId = document.engagementId
      return result
    })
  }
  startNewEngagement(previous: EngagementDocument, hydrate: (document: EngagementDocument) => void): Promise<RepositoryMutation> {
    const next = engagementFromSession({ tenantId: previous.tenantId, brandLabel: previous.brandLabel, session: resetAssessmentSession(), respondents: [], appVersion: ASSESSMENT_VERSION })
    return this.replace(() => this.repository.startNewEngagement(previous, next), hydrate).catch(() => ({ ok: false, code: "storage_failure" }))
  }
  async replace(operation: () => Promise<RepositoryMutation>, hydrate: (document: EngagementDocument) => void) {
    return this.queue.run(async () => {
      const result = await operation()
      if (!result.ok) return result
      if (!result.document) return { ok: false as const, code: "storage_failure" as const, errors: ["Assessment replacement could not be verified"] }
      this.replacementEpoch += 1
      this.engagementId = result.document.engagementId
      hydrate(result.document)
      return result
    })
  }
  async claim(source: "v26" | "engagement_v1", hydrate: (document: EngagementDocument) => void) {
    return this.queue.run(async () => {
      const result = await this.repository.claimLegacy(source)
      if (result.ok && result.document) {
        this.replacementEpoch += 1
        this.engagementId = result.document.engagementId
        hydrate(result.document)
        return result
      }
      return result
    })
  }
  exportEngagement() { return this.queue.run(() => this.repository.exportEngagement()) }
  exportLegacyRawKey(key: "assessment_session_v26" | "assessment_respondents_v26" | "assessment_engagement_v1") { return this.queue.run(() => this.repository.exportLegacyRawKey(key)) }
}

export function assessmentSaveStatusLabel(status: "idle" | "saving" | "saved" | "unsaved") {
  if (status === "idle") return "Ready to save changes."
  if (status === "saving") return "Saving to this browser…"
  if (status === "saved") return "Saved to this browser."
  return "Changes are not saved."
}
export function saveStatusAfterHydration(previous: "idle" | "saving" | "saved" | "unsaved", repositoryStatus: RepositoryLoad["status"]) { return repositoryStatus === "ready" ? "saved" as const : repositoryStatus === "empty" ? "idle" as const : previous }

interface AssessmentContextValue {
  engagementId: string | null; startNewEngagement: () => Promise<RepositoryMutation>; addRespondent: () => void; clientInfo: ClientInfo; setClientField: (field: keyof ClientInfo, value: string) => void; scores: ScoreMap; evidence: EvidenceMap; currentPillar: number; setCurrentPillar: (n: number) => void; setScore: (pillarKey: string, dimKey: string, value: number) => void; setEvidence: (pillarKey: string, dimKey: string, value: string) => void; respondents: Respondent[]; saveRespondent: (name: string, role: string) => void; editingRespondentId: string | null; beginRespondentEdit: (edit: RespondentEdit) => void; cancelRespondentEdit: () => void; removeRespondent: (id: string) => void; clearRespondents: () => void; resetSession: () => void; loadScores: (scores: ScoreMap, clientInfo?: Partial<ClientInfo>) => void; demoMode: boolean; setDemoMode: (on: boolean) => void; readout: EngagementReadout | null; saveReadout: (readout: EngagementReadout | null) => void; hydrated: boolean; repositoryStatus: RepositoryLoad["status"]; legacyClaimSource: "v26" | "engagement_v1" | null; operationFeedback: string | null; saveStatus: "idle" | "saving" | "saved" | "unsaved"; retrySave: () => Promise<void>; claimLegacy: (source: "v26" | "engagement_v1") => Promise<RepositoryMutation>; resumeLegacyClaim: () => Promise<RepositoryMutation>; exportEngagement: () => Promise<string | null>; exportLegacyRawKey: (key: "assessment_session_v26" | "assessment_respondents_v26" | "assessment_engagement_v1") => Promise<string | null>; restoreEngagement: (serialized: string) => Promise<RepositoryMutation>; restoreBackup: () => Promise<RepositoryMutation>
}
const AssessmentContext = createContext<AssessmentContextValue | null>(null)

export interface RespondentEditState { editingRespondentId: string | null; origin: AssessmentSession | null }
export type RespondentEditAction = { type: "begin"; respondentId: string; origin: AssessmentSession } | { type: "remove"; respondentId: string } | { type: "cancel" | "reset" | "save" | "demo-switch" }
export const idleRespondentEditState: RespondentEditState = { editingRespondentId: null, origin: null }
export function respondentEditReducer(state: RespondentEditState, action: RespondentEditAction): RespondentEditState { if (action.type === "begin") return { editingRespondentId: action.respondentId, origin: state.origin ?? action.origin }; if (action.type === "remove" && action.respondentId !== state.editingRespondentId) return state; return idleRespondentEditState }
export function restoreRespondentEditSession(active: AssessmentSession, origin: AssessmentSession | null): AssessmentSession { return origin ?? active }
export type RespondentEditTransitionAction = { type: "begin"; edit: RespondentEdit } | { type: "remove"; respondentId: string } | { type: "cancel" | "reset" | "save" | "demo-switch" | "clear" }
export interface RespondentEditTransition { session: AssessmentSession; editState: RespondentEditState }
function editReducerAction(action: RespondentEditTransitionAction, active: AssessmentSession): RespondentEditAction { if (action.type === "begin") return { type: "begin", respondentId: action.edit.id, origin: active }; if (action.type === "remove") return action; if (action.type === "clear") return { type: "reset" }; return { type: action.type } }
export function transitionRespondentEdit(active: AssessmentSession, state: RespondentEditState, action: RespondentEditTransitionAction): RespondentEditTransition { const editState = respondentEditReducer(state, editReducerAction(action, active)); if (action.type === "begin") return { session: loadRespondentForEdit(active, action.edit), editState }; if (action.type === "reset") return { session: resetAssessmentSession(), editState }; const restoresOrigin = action.type === "cancel" || action.type === "demo-switch" || action.type === "clear" || (action.type === "remove" && action.respondentId === state.editingRespondentId); return restoresOrigin ? { session: restoreRespondentEditSession(active, state.origin), editState } : { session: active, editState } }
export function loadRespondentForEdit(session: AssessmentSession, edit: RespondentEdit): AssessmentSession { return { ...session, clientInfo: { ...session.clientInfo, name: edit.company, department: edit.department, operatingProfile: edit.operatingProfile }, scores: { ...edit.scores }, evidence: { ...edit.evidence }, currentPillar: 0 } }
function makeDemoSession(): AssessmentSession { return { clientInfo: { ...SAMPLE_CLIENT }, scores: makeSampleScores(), evidence: {}, currentPillar: 0 } }
// A document owns its complete roster. Reload, import and restore replace it rather than merge rosters.
function fromDocument(document: EngagementDocument): { session: AssessmentSession; respondents: Respondent[] } { return { session: { clientInfo: { ...document.session.clientInfo }, scores: { ...document.session.scores }, evidence: { ...document.session.evidence }, currentPillar: document.session.currentPillar }, respondents: document.respondents.map((r) => ({ ...r, scores: { ...r.scores }, evidence: { ...r.evidence } })) } }
function persistedSnapshot(session: AssessmentSession, respondents: Respondent[], readout: EngagementReadout | null) { return JSON.stringify({ session, respondents, readout }) }
export function sessionForPersistence(session: AssessmentSession, editState: RespondentEditState): AssessmentSession { return editState.editingRespondentId === null ? session : editState.origin ?? session }
export function selectAssessmentReadout(demoMode: boolean, realReadout: EngagementReadout | null, demoReadout: EngagementReadout | null) { return demoMode ? demoReadout : realReadout }
export function saveAssessmentReadout(demoMode: boolean, next: EngagementReadout | null, realReadout: EngagementReadout | null, demoReadout: EngagementReadout | null) { return demoMode ? { realReadout, demoReadout: next } : { realReadout: next, demoReadout } }
function mutationFeedback(result: RepositoryMutation, operation: "claim" | "restore") { if (result.ok) return null; if (result.code === "legacy_exclusion_unavailable") return "Legacy recovery needs an exclusive browser lock before it can continue."; if (result.code === "conflict") return operation === "claim" ? "Legacy recovery conflicts with another saved state." : "The saved engagement changed before restore completed."; if (result.code === "storage_failure") return operation === "claim" ? "Legacy recovery could not finish saving." : "The engagement could not be saved."; if (result.code === "tenant_mismatch") return "This engagement belongs to another tenant."; return operation === "claim" ? "Legacy Assessment data failed validation." : "That engagement backup is invalid." }

function useNewEngagement({ available, persistence, currentDocument, hydrate, feedback }: {
  available: boolean
  persistence: AssessmentPersistenceCoordinator
  currentDocument: () => EngagementDocument
  hydrate: (document: EngagementDocument) => void
  feedback: (message: string | null) => void
}) {
  const replacing = useRef(false)
  return async (): Promise<RepositoryMutation> => {
    if (!available || replacing.current) return { ok: false, code: "conflict" }
    replacing.current = true
    feedback(null)
    try {
      const result = await persistence.startNewEngagement(currentDocument(), hydrate)
      feedback(result.ok ? null : "The new engagement could not be started. Your current engagement is still open. Retry after checking browser storage.")
      return result
    } finally { replacing.current = false }
  }
}

export function AssessmentProvider({ children, tenantId = getAssessmentTenantId() ?? "local", brandLabel, repository: suppliedRepository }: { children: ReactNode; tenantId?: string; brandLabel?: string | null; repository?: AssessmentRepository }) {
  const repositoryRef = useRef<AssessmentRepository | null>(suppliedRepository ?? null)
  const repositoryTenant = useRef<string | null>(null)
  if (suppliedRepository) repositoryRef.current = suppliedRepository
  else if (!repositoryRef.current || repositoryTenant.current !== tenantId) { repositoryRef.current = new LocalAssessmentRepository(tenantId, undefined, undefined, brandLabel ?? getAssessmentRuntimeConfig().brand.displayName); repositoryTenant.current = tenantId }
  const repository = repositoryRef.current
  if (!repository) throw new Error("Assessment repository is unavailable")
  const [session, setSession] = useState(resetAssessmentSession)
  const [engagementId, setEngagementId] = useState<string | null>(null)
  const [respondents, setRespondents] = useState<Respondent[]>([])
  const [readout, setReadout] = useState<EngagementReadout | null>(null)
  const [demoReadout, setDemoReadout] = useState<EngagementReadout | null>(null)
  const [demoMode, setDemo] = useState(false)
  const [demoSession, setDemoSession] = useState(makeDemoSession)
  const [demoRespondents, setDemoRespondents] = useState<Respondent[]>(makeSampleRespondents)
  const [editState, setEditState] = useState<RespondentEditState>(idleRespondentEditState)
  const [hydrated, setHydrated] = useState(false)
  const [repositoryStatus, setRepositoryStatus] = useState<RepositoryLoad["status"]>("empty")
  const [legacyClaimSource, setLegacyClaimSource] = useState<"v26" | "engagement_v1" | null>(null)
  const [operationFeedback, setOperationFeedback] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "unsaved">("idle")
  const metadata = useRef<{ engagementId?: string; createdAt?: string; legacyClaim?: EngagementDocument["legacyClaim"] }>({})
  const saveTrackerRef = useRef(new AssessmentSaveTracker())
  const skipNextSave = useRef(true)
  const applyLoadStatus = (loaded: RepositoryLoad) => { setRepositoryStatus(loaded.status); setLegacyClaimSource(loaded.status === "legacy_claim_pending" ? loaded.source : null); return loaded }
  const coordinator = useRef<AssessmentPersistenceCoordinator | null>(null)
  if (!coordinator.current || coordinator.current.currentRepository !== repository) coordinator.current = new AssessmentPersistenceCoordinator(repository)
  const persistence = coordinator.current
  const hydrateDocument = useCallback((document: EngagementDocument) => { const state = fromDocument(document); setEngagementId(document.engagementId); metadata.current = { engagementId: document.engagementId, createdAt: document.createdAt, legacyClaim: document.legacyClaim }; saveTrackerRef.current.hydrate(persistedSnapshot(state.session, state.respondents, document.readout)); skipNextSave.current = true; setSession(state.session); setRespondents(state.respondents); setReadout(document.readout); setEditState(idleRespondentEditState); setRepositoryStatus("ready"); setSaveStatus("saved"); setLegacyClaimSource(null) }, [])
  const refreshStatus = async () => { try { return applyLoadStatus(await persistence.load()) } catch { const failed: RepositoryLoad = { status: "invalid", errors: ["Assessment storage operation failed"] }; return applyLoadStatus(failed) } }
  useEffect(() => { let active = true; setHydrated(false); skipNextSave.current = true; setEditState(idleRespondentEditState); void persistence.load().then((loaded) => { if (!active) return; applyLoadStatus(loaded); if (loaded.status === "ready") hydrateDocument(loaded.document); else { metadata.current = {}; setEngagementId(null); const empty = resetAssessmentSession(); saveTrackerRef.current.hydrate(persistedSnapshot(empty, [], null)); setSession(empty); setRespondents([]); setReadout(null); setSaveStatus("idle") }; setHydrated(true) }).catch(() => { if (!active) return; setRepositoryStatus("invalid"); setOperationFeedback("Assessment storage could not be read."); setHydrated(true) }); return () => { active = false } }, [persistence, tenantId, hydrateDocument])
  // Bind autosaves to their rendered engagement, even before replacement state commits.
  useEffect(() => { if (!hydrated || skipNextSave.current) { if (hydrated) skipNextSave.current = false; return } if (engagementId !== (metadata.current.engagementId ?? null)) return; if (demoMode || repositoryStatus === "invalid" || repositoryStatus === "legacy_available" || repositoryStatus === "legacy_claim_pending" || repositoryStatus === "legacy_claimed_elsewhere") return; const saveSession = sessionForPersistence(session, editState); const snapshot = persistedSnapshot(saveSession, respondents, readout); const ticket = saveTrackerRef.current.schedule(snapshot); if (!ticket) return; const current = engagementFromSession({ tenantId, brandLabel: brandLabel ?? getAssessmentRuntimeConfig().brand.displayName, session: saveSession, respondents, appVersion: ASSESSMENT_VERSION, engagementId: metadata.current.engagementId, createdAt: metadata.current.createdAt, readout, legacyClaim: null }); metadata.current = { engagementId: current.engagementId, createdAt: current.createdAt, legacyClaim: null }; setEngagementId(current.engagementId); setSaveStatus("saving"); void persistence.save(current).then((result) => { if (!saveTrackerRef.current.complete(ticket, result.ok)) return; if (!result.ok && result.code === "conflict" && result.errors?.[0] === "Assessment state was replaced before save") return; if (!result.ok && result.errors?.[0] === STALE_ENGAGEMENT) setOperationFeedback(STALE_ENGAGEMENT); setSaveStatus(result.ok ? "saved" : "unsaved") }).catch(() => { if (saveTrackerRef.current.complete(ticket, false)) setSaveStatus("unsaved") }) }, [session, respondents, readout, hydrated, demoMode, editState, repositoryStatus, persistence, tenantId, brandLabel, engagementId])
  const cur = demoMode ? demoSession : session
  const setCur = demoMode ? setDemoSession : setSession
  const curRespondents = demoMode ? demoRespondents : respondents
  const setCurRespondents = demoMode ? setDemoRespondents : setRespondents
  const blockedDemoMutation = (): RepositoryMutation => ({ ok: false, code: "conflict", errors: ["Demo Assessment data cannot be restored or claimed"] })
  const claim = async (source: "v26" | "engagement_v1") => { if (demoMode) return blockedDemoMutation(); setOperationFeedback(null); const result = await persistence.claim(source, hydrateDocument).catch(() => ({ ok: false as const, code: "storage_failure" as const, errors: ["Assessment storage operation failed"] })); const loaded = await refreshStatus(); if (!result.ok && loaded.status === "legacy_claim_pending") setLegacyClaimSource(loaded.source); setOperationFeedback(mutationFeedback(result, "claim")); return result }
  const restore = async (serialized: string) => { if (demoMode) return blockedDemoMutation(); setOperationFeedback(null); const result = await persistence.replace(() => repository.importJson(serialized), hydrateDocument).catch(() => ({ ok: false as const, code: "storage_failure" as const, errors: ["Assessment storage operation failed"] })); if (!result.ok) await refreshStatus(); setOperationFeedback(mutationFeedback(result, "restore")); return result }
  const restoreBackup = async () => { if (demoMode) return blockedDemoMutation(); setOperationFeedback(null); const result = await persistence.replace(() => repository.restoreBackup(), hydrateDocument).catch(() => ({ ok: false as const, code: "storage_failure" as const, errors: ["Assessment storage operation failed"] })); if (!result.ok) await refreshStatus(); setOperationFeedback(mutationFeedback(result, "restore")); return result }
  const startNewEngagement = useNewEngagement({
    available: hydrated && !demoMode, persistence, hydrate: hydrateDocument, feedback: setOperationFeedback,
    currentDocument: () => engagementFromSession({ tenantId, brandLabel: brandLabel ?? getAssessmentRuntimeConfig().brand.displayName, session: sessionForPersistence(session, editState), respondents, appVersion: ASSESSMENT_VERSION, engagementId: metadata.current.engagementId, createdAt: metadata.current.createdAt, readout }),
  })
  const value: AssessmentContextValue = {
    engagementId: demoMode ? "demo" : engagementId, startNewEngagement,
    addRespondent: () => { setCur((state) => ({ ...state, scores: {}, evidence: {}, currentPillar: 0 })); setEditState(idleRespondentEditState) },
    clientInfo: cur.clientInfo, setClientField: (field, value) => setCur((state) => ({ ...state, clientInfo: { ...state.clientInfo, [field]: value } })), scores: cur.scores, evidence: cur.evidence, currentPillar: cur.currentPillar, setCurrentPillar: (n) => setCur((state) => ({ ...state, currentPillar: n })), setScore: (pk, dk, value) => setCur((state) => ({ ...state, scores: { ...state.scores, [scoreKey(pk, dk)]: value } })), setEvidence: (pk, dk, value) => setCur((state) => ({ ...state, evidence: { ...state.evidence, [scoreKey(pk, dk)]: value } })), respondents: curRespondents, editingRespondentId: editState.editingRespondentId,
    beginRespondentEdit: (edit) => { if (!curRespondents.some((respondent) => respondent.id === edit.id)) return; const next = transitionRespondentEdit(cur, editState, { type: "begin", edit }); setEditState(next.editState); setCur(next.session) }, cancelRespondentEdit: () => { const next = transitionRespondentEdit(cur, editState, { type: "cancel" }); setCur(next.session); setEditState(next.editState) },
    saveRespondent: (name, role) => { const trimmed = name.trim(); if (!trimmed) return; const company = cur.clientInfo.name.trim(); const department = cur.clientInfo.department.trim(); const id = editState.editingRespondentId ?? createUniqueRespondentId(curRespondents, company, department, trimmed); const entry: RespondentEdit = { id, company, department, operatingProfile: cur.clientInfo.operatingProfile, name: trimmed, role: role.trim(), scores: { ...cur.scores }, evidence: { ...cur.evidence } }; const timestamp = new Date().toISOString(); setCurRespondents((items) => editState.editingRespondentId ? applyRespondentEdit(items, entry, timestamp) : upsertRespondent(items, { ...entry, timestamp })); setEditState(transitionRespondentEdit(cur, editState, { type: "save" }).editState) }, removeRespondent: (id) => { const next = transitionRespondentEdit(cur, editState, { type: "remove", respondentId: id }); setCurRespondents((items) => items.filter((r) => r.id !== id)); setCur(next.session); setEditState(next.editState) }, clearRespondents: () => { const next = transitionRespondentEdit(cur, editState, { type: "clear" }); setCurRespondents([]); setCur(next.session); setEditState(next.editState) }, resetSession: () => { const next = transitionRespondentEdit(cur, editState, { type: "reset" }); setCur(next.session); setEditState(next.editState) }, loadScores: (scores, clientInfo) => { setCur({ ...emptyAssessmentSession, scores: { ...scores }, clientInfo: { ...emptyAssessmentSession.clientInfo, ...(clientInfo ?? {}) } }); setEditState(idleRespondentEditState) },
    demoMode, setDemoMode: (on) => { const next = transitionRespondentEdit(cur, editState, { type: "demo-switch" }); setCur(next.session); setEditState(next.editState); setDemoReadout(null); if (on) { setDemoSession(makeDemoSession()); setDemoRespondents(makeSampleRespondents()) } setDemo(on) }, readout: selectAssessmentReadout(demoMode, readout, demoReadout), saveReadout: (next) => { if (!demoMode && engagementId !== (metadata.current.engagementId ?? null)) return; const saved = saveAssessmentReadout(demoMode, next, readout, demoReadout); setReadout(saved.realReadout); setDemoReadout(saved.demoReadout) }, hydrated, repositoryStatus, legacyClaimSource, operationFeedback, saveStatus,
    retrySave: async () => { if (!hydrated || demoMode || engagementId !== (metadata.current.engagementId ?? null)) return; const saveSession = sessionForPersistence(session, editState); const current = engagementFromSession({ tenantId, brandLabel: brandLabel ?? getAssessmentRuntimeConfig().brand.displayName, session: saveSession, respondents, appVersion: ASSESSMENT_VERSION, engagementId: metadata.current.engagementId, createdAt: metadata.current.createdAt, readout, legacyClaim: null }); const snapshot = persistedSnapshot(saveSession, respondents, readout); const ticket = saveTrackerRef.current.retry(snapshot); setSaveStatus("saving"); try { const result = await persistence.save(current); if (!saveTrackerRef.current.complete(ticket, result.ok)) return; setSaveStatus(result.ok ? "saved" : "unsaved") } catch { if (saveTrackerRef.current.complete(ticket, false)) setSaveStatus("unsaved") } },
    claimLegacy: claim, resumeLegacyClaim: () => legacyClaimSource ? claim(legacyClaimSource) : Promise.resolve({ ok: false, code: "invalid", errors: ["No pending legacy recovery is available"] }),
    exportEngagement: async () => { if (demoMode) return null; const content = await persistence.exportEngagement().catch(() => null); setOperationFeedback(content ? null : "Engagement backup is unavailable until a verified saved assessment exists."); return content }, exportLegacyRawKey: async (key) => { if (demoMode) return null; const content = await persistence.exportLegacyRawKey(key).catch(() => null); setOperationFeedback(content ? null : "Original legacy recovery is unavailable for this tenant."); return content }, restoreEngagement: restore, restoreBackup,
  }
  return <AssessmentContext.Provider value={value}>{children}</AssessmentContext.Provider>
}
export function useAssessment() { const context = useContext(AssessmentContext); if (!context) throw new Error("useAssessment must be used within AssessmentProvider"); return context }
