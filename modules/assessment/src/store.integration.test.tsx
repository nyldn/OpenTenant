import { StrictMode, type MutableRefObject } from "react"
import { act, create, type ReactTestRenderer } from "react-test-renderer"
import { describe, expect, it } from "vitest"
import { AssessmentProvider, type AssessmentSession, useAssessment } from "./store"
import type { AssessmentRepository, RepositoryLoad } from "./persistence/assessment-repository"
import { engagementFromSession, type EngagementDocument } from "./persistence/engagement-schema"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type AssessmentValue = ReturnType<typeof useAssessment>
type RepositoryOverrides = Partial<AssessmentRepository>

const session: AssessmentSession = { clientInfo: { name: "Synthetic Organisation", department: "Ops", operatingProfile: "", date: "", facilitator: "Facilitator" }, scores: { "strategy__ai_vision": 3 }, evidence: {}, currentPillar: 0 }
function document(name = session.clientInfo.name): EngagementDocument { return engagementFromSession({ tenantId: "tenant-a", appVersion: "v1.0.0", session: { ...session, clientInfo: { ...session.clientInfo, name } }, respondents: [], engagementId: "eng_1", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z" }) }
function repository(overrides: RepositoryOverrides = {}): AssessmentRepository {
  return {
    load: async () => ({ status: "empty" }),
    save: async () => ({ ok: true }),
    exportJson: async () => null,
    exportEngagement: async () => null,
    exportLegacyRaw: async () => null,
    exportLegacyRawKey: async () => null,
    importJson: async () => ({ ok: true, document: document("Imported") }),
    startNewEngagement: async (_previous, next) => ({ ok: true, document: next }), restoreBackup: async () => ({ ok: true, document: document("Restored") }),
    clear: async () => ({ ok: true }),
    claimLegacy: async () => ({ ok: false, code: "invalid", errors: ["synthetic"] }),
    ...overrides,
  }
}
function Capture({ current }: { current: MutableRefObject<AssessmentValue | undefined> }) { current.current = useAssessment(); return null }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
function mounted(repo: AssessmentRepository, current: MutableRefObject<AssessmentValue | undefined>, strict = false): ReactTestRenderer {
  const children = <AssessmentProvider repository={repo} tenantId="tenant-a"><Capture current={current} /></AssessmentProvider>
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(strict ? <StrictMode>{children}</StrictMode> : children) })
  return renderer
}

describe("mounted AssessmentProvider persistence", () => {
  it("waits for hydration, then reports verified ready state without saving", async () => {
    let release!: (value: RepositoryLoad) => void
    const load = new Promise<RepositoryLoad>((resolve) => { release = resolve })
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    let saves = 0
    const hydratedDocument = engagementFromSession({
      tenantId: "tenant-a",
      appVersion: "v1.0.0",
      session: { ...session, evidence: { "strategy__ai_vision": "Board-approved evidence" }, currentPillar: 3 },
      respondents: [{ id: "respondent-1", company: "Synthetic Organisation", department: "Ops", operatingProfile: "", name: "Alex", role: "Director", timestamp: "2026-09-06T00:00:00.000Z", scores: { "strategy__ai_vision": 4 }, evidence: { "strategy__ai_vision": "Respondent evidence" } }],
      engagementId: "eng_1",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      readout: { text: "Stored readout", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: `sha256:${"a".repeat(64)}` },
    })
    const repo = repository({ load: async () => load, save: async () => { saves += 1; return { ok: true } } })
    const renderer = mounted(repo, current)
    expect(current.current?.hydrated).toBe(false)
    await act(async () => { release({ status: "ready", document: hydratedDocument }); await Promise.resolve(); await Promise.resolve() })
    expect(current.current?.hydrated).toBe(true)
    expect(current.current?.repositoryStatus).toBe("ready")
    expect(current.current?.saveStatus).toBe("saved")
    expect(current.current?.clientInfo).toEqual(hydratedDocument.session.clientInfo)
    expect(current.current?.scores).toEqual(hydratedDocument.session.scores)
    expect(current.current?.evidence).toEqual(hydratedDocument.session.evidence)
    expect(current.current?.currentPillar).toBe(3)
    expect(current.current?.respondents).toEqual(hydratedDocument.respondents)
    expect(current.current?.readout).toEqual(hydratedDocument.readout)
    expect(saves).toBe(0)
    act(() => { renderer.unmount() })
  })

  it("persists A after a delayed A to B to A edit sequence", async () => {
    let stored = document("A")
    let releaseB!: () => void
    const bPending = new Promise<void>((resolve) => { releaseB = resolve })
    const savedNames: string[] = []
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const repo = repository({
      load: async () => ({ status: "ready", document: stored }),
      save: async (next) => {
        const name = next.session.clientInfo.name
        savedNames.push(name)
        if (name === "B") await bPending
        stored = next
        return { ok: true, document: next }
      },
    })
    const renderer = mounted(repo, current); await settle()
    await act(async () => { current.current!.setClientField("name", "B"); await Promise.resolve() })
    await act(async () => { current.current!.setClientField("name", "A"); await Promise.resolve() })
    releaseB()
    await settle()
    expect(savedNames).toEqual(["B", "A"])
    expect(stored.session.clientInfo.name).toBe("A")
    expect(current.current?.clientInfo.name).toBe("A")
    expect(current.current?.saveStatus).toBe("saved")
    act(() => { renderer.unmount() })
  })

  it("clears failed autosave status after a successful verified restore", async () => {
    let saves = 0
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const repo = repository({ save: async () => { saves += 1; return { ok: false, code: "storage_failure", errors: ["synthetic"] } }, importJson: async () => ({ ok: true, document: document("Restored") }) })
    const renderer = mounted(repo, current); await settle()
    await act(async () => { current.current!.setClientField("name", "Changed once") }); await settle()
    await act(async () => { current.current!.setClientField("name", "Changed twice") }); await settle()
    expect(saves).toBeGreaterThan(0)
    expect(current.current?.saveStatus).toBe("unsaved")
    await act(async () => { await current.current!.restoreEngagement(JSON.stringify(document("Restored"))) })
    expect(current.current?.clientInfo.name).toBe("Restored")
    expect(current.current?.saveStatus).toBe("saved")
    act(() => { renderer.unmount() })
  })

  it("preserves the visible state when a restore fails", async () => {
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const repo = repository({ load: async () => ({ status: "ready", document: document("Original") }), importJson: async () => ({ ok: false, code: "storage_failure", errors: ["synthetic"] }) })
    const renderer = mounted(repo, current)
    await settle()
    await act(async () => { await current.current!.restoreEngagement("not-used") })
    expect(current.current?.clientInfo.name).toBe("Original")
    expect(current.current?.repositoryStatus).toBe("ready")
    expect(current.current?.operationFeedback).toContain("could not be saved")
    act(() => { renderer.unmount() })
  })

  it("hydrates restore after an older queued save and resets edit identity", async () => {
    let releaseSave!: () => void
    const saveStarted = new Promise<void>((resolve) => { releaseSave = resolve })
    const events: string[] = []
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const initial = engagementFromSession({ tenantId: "tenant-a", appVersion: "v1.0.0", session, respondents: [{ id: "respondent-1", company: "Synthetic Organisation", department: "Ops", operatingProfile: "", name: "Alex", role: "Director", timestamp: "2026-09-06T00:00:00.000Z", scores: {}, evidence: {} }], engagementId: "eng_1", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z" })
    let stored = initial
    const restored = document("Restored after queue")
    const repo = repository({
      load: async () => ({ status: "ready", document: stored }),
      save: async (next) => { events.push("save-start"); await saveStarted; stored = next; events.push("save-end"); return { ok: true, document: next } },
      importJson: async () => { events.push("restore"); stored = restored; return { ok: true, document: restored } },
    })
    const renderer = mounted(repo, current); await settle()
    await act(async () => { current.current!.setClientField("name", "Queued autosave"); await Promise.resolve() })
    expect(current.current?.saveStatus).toBe("saving")
    await act(async () => { current.current!.beginRespondentEdit(initial.respondents[0]!) })
    expect(current.current?.editingRespondentId).toBe("respondent-1")
    await act(async () => { current.current!.setClientField("name", "Unfinished respondent edit") })
    let restore!: ReturnType<AssessmentValue["restoreEngagement"]>
    await act(async () => { restore = current.current!.restoreEngagement(JSON.stringify(document("Restored after queue"))); await Promise.resolve() })
    await act(async () => { current.current!.clearRespondents(); await Promise.resolve() })
    releaseSave()
    await act(async () => { await restore })
    await settle()
    expect(events).toEqual(["save-start", "save-end", "restore"])
    expect(stored).toEqual(restored)
    expect(current.current?.clientInfo.name).toBe("Restored after queue")
    expect(current.current?.editingRespondentId).toBeNull()
    expect(current.current?.saveStatus).toBe("saved")
    act(() => { renderer.unmount() })
  })

  it("blocks restore and legacy claim while demo mode is active", async () => {
    let imports = 0; let claims = 0
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const repo = repository({ importJson: async () => { imports += 1; return { ok: true, document: document("Imported") } }, claimLegacy: async () => { claims += 1; return { ok: true, document: document("Claimed") } } })
    const renderer = mounted(repo, current); await settle()
    await act(async () => { current.current!.setDemoMode(true) })
    await act(async () => {
      expect((await current.current!.restoreEngagement("ignored")).ok).toBe(false)
      expect((await current.current!.claimLegacy("v26")).ok).toBe(false)
    })
    expect(imports).toBe(0)
    expect(claims).toBe(0)
    act(() => { renderer.unmount() })
  })
})

// The document owns its roster. Draft resets and respondent edits never replace it.
describe("engagement transitions", () => {
  async function realStore() {
    const { LocalAssessmentRepository } = await import("./persistence/assessment-repository")
    const map = new Map<string, string>()
    const repo = new LocalAssessmentRepository("tenant-a", { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value) }, removeItem: key => { map.delete(key) } })
    const original = document("Client A")
    original.respondents = [{ id: "a", company: "Client A", department: "Ops", operatingProfile: "", name: "Respondent A", role: "Director", timestamp: original.createdAt, scores: { ...original.session.scores }, evidence: { "strategy__ai_vision": "A evidence" } }]
    original.readout = { text: "A readout", generatedAt: null, inputDigest: null }
    await repo.save(original)
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const renderer = mounted(repo, current)
    await settle()
    return { repo, current, renderer, original }
  }

  it("separates Clear draft and Add respondent from New engagement and restores the previous roster", async () => {
    const { repo, current, renderer, original } = await realStore()
    try {
      await act(async () => { current.current!.addRespondent() })
      expect(current.current!.engagementId).toBe(original.engagementId)
      expect(current.current!.clientInfo.name).toBe("Client A")
      expect(current.current!.scores).toEqual({})
      expect(current.current!.respondents).toEqual(original.respondents)
      await act(async () => { current.current!.resetSession() })
      expect(current.current!.engagementId).toBe(original.engagementId)
      expect(current.current!.clientInfo.name).toBe("")
      expect(current.current!.respondents).toEqual(original.respondents)
      // Restore A, open an edit, and leave changes uncommitted.
      await act(async () => { await current.current!.restoreEngagement(JSON.stringify(original)) })
      await act(async () => { current.current!.beginRespondentEdit(original.respondents[0]!) })
      await act(async () => { current.current!.setScore("strategy", "ai_vision", 5) })
      const lateReadout = current.current!.saveReadout
      await act(async () => { expect((await current.current!.startNewEngagement()).ok).toBe(true) })
      await act(async () => { lateReadout(original.readout) })
      expect(current.current!.engagementId).not.toBe(original.engagementId)
      expect(current.current!.respondents).toEqual([])
      expect(current.current!.scores).toEqual({})
      expect(current.current!.readout).toBeNull()
      expect(current.current!.editingRespondentId).toBeNull()
      await act(async () => { current.current!.cancelRespondentEdit() })
      expect(current.current!.clientInfo.name).toBe("")
      await act(async () => { current.current!.setClientField("name", "Client B"); current.current!.setScore("strategy", "ai_vision", 4) })
      await act(async () => { current.current!.saveRespondent("Respondent B", "Director") })
      await settle()
      const b = JSON.parse((await repo.exportEngagement())!) as EngagementDocument
      expect(b.respondents).toHaveLength(1)
      expect(b.respondents[0]!.scores).toEqual({ "strategy__ai_vision": 4 })
      expect(JSON.stringify(b)).not.toContain("Client A")
      await act(async () => { expect((await current.current!.restoreBackup()).ok).toBe(true) })
      expect(current.current!.engagementId).toBe(original.engagementId)
      expect(current.current!.scores).toEqual(original.session.scores)
      expect(current.current!.respondents).toEqual(original.respondents)
      expect(current.current!.readout).toEqual(original.readout)
    } finally { act(() => { renderer.unmount() }) }
  })

  it("waits for an in-flight autosave before New and ignores a late retry from A", async () => {
    const { repo, current, renderer, original } = await realStore()
    const save = repo.save.bind(repo)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const writes: string[] = []
    repo.save = async next => { writes.push(next.engagementId); await pending; return save(next) }
    try {
      await act(async () => { current.current!.setEvidence("strategy", "ai_vision", "Latest A evidence") })
      expect(current.current!.saveStatus).toBe("saving")
      const lateRetry = current.current!.retrySave
      let replacement!: ReturnType<AssessmentValue["startNewEngagement"]>
      await act(async () => { replacement = current.current!.startNewEngagement(); await Promise.resolve() })
      expect(current.current!.engagementId).toBe(original.engagementId)
      release()
      await act(async () => { expect((await replacement).ok).toBe(true) })
      const bId = current.current!.engagementId
      expect(bId).not.toBe(original.engagementId)
      await act(async () => { await lateRetry() })
      expect(writes).toEqual([original.engagementId])
      expect(await repo.load()).toMatchObject({ status: "ready", document: { engagementId: bId, respondents: [], readout: null, session: { scores: {}, evidence: {} } } })
      await act(async () => { current.current!.setClientField("name", "Client B"); current.current!.setScore("strategy", "ai_vision", 4) })
      await settle()
      expect(writes).toEqual([original.engagementId, bId])
      await act(async () => { expect((await current.current!.restoreBackup()).ok).toBe(true) })
      expect(current.current!.engagementId).toBe(original.engagementId)
      expect(current.current!.scores).toEqual(original.session.scores)
      expect(current.current!.evidence).toEqual({ "strategy__ai_vision": "Latest A evidence" })
      expect(current.current!.respondents).toEqual(original.respondents)
    } finally { release(); act(() => { renderer.unmount() }) }
  })

  it("keeps the current session and edit origin when New engagement cannot save its backup", async () => {
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const initial = document("Client A")
    initial.respondents = [{ id: "a", company: "Client A", department: "Ops", operatingProfile: "", name: "A", role: "", timestamp: initial.createdAt, scores: {}, evidence: {} }]
    const renderer = mounted(repository({ load: async () => ({ status: "ready", document: initial }), startNewEngagement: async () => ({ ok: false, code: "storage_failure" }) }), current)
    await settle()
    try {
      await act(async () => { current.current!.beginRespondentEdit(initial.respondents[0]!) })
      await act(async () => { current.current!.setClientField("name", "Uncommitted edit") })
      await act(async () => { expect((await current.current!.startNewEngagement()).ok).toBe(false) })
      expect(current.current!.clientInfo.name).toBe("Uncommitted edit")
      expect(current.current!.editingRespondentId).toBe("a")
      await act(async () => { current.current!.cancelRespondentEdit() })
      expect(current.current!.clientInfo.name).toBe("Client A")
      expect(current.current!.operationFeedback).toContain("still open")
    } finally { act(() => { renderer.unmount() }) }
  })
})
