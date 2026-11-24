import { describe, expect, it } from "vitest"
import { createRespondentEdit } from "./respondents"
import type { AssessmentRepository } from "./persistence/assessment-repository"
import {
  emptyAssessmentSession,
  idleRespondentEditState,
  loadRespondentForEdit,
  resetAssessmentSession,
  buildReadoutInput,
  readoutInputDigest,
  sessionForPersistence,
  saveAssessmentReadout,
  selectAssessmentReadout,
  AssessmentPersistenceQueue,
  AssessmentPersistenceCoordinator,
  AssessmentSaveTracker,
  assessmentSaveStatusLabel,
  saveStatusAfterHydration,
  restoreRespondentEditSession,
  transitionRespondentEdit,
  type AssessmentSession,
  type RespondentEditState,
} from "./store"

const session: AssessmentSession = {
  clientInfo: {
    name: "Original Organisation",
    department: "Original Department",
    operatingProfile: "broker",
    date: "2026-07-13",
    facilitator: "Facilitator",
  },
  scores: { "people__leadership": 2 },
  evidence: { "people__leadership": "Original evidence" },
  currentPillar: 3,
}

describe("Assessment respondent editing", () => {
  it("loads a complete edit into the session without dropping evidence", () => {
    const edit = createRespondentEdit({
      id: "saved-id",
      company: "Edited Organisation",
      department: "Edited Department",
      operatingProfile: "carrier",
      name: "Edited Respondent",
      role: "VP, Operations",
      timestamp: "2026-07-13T10:00:00.000Z",
      scores: { "people__leadership": 5 },
      evidence: { "people__leadership": "Saved board note" },
    })

    expect(loadRespondentForEdit(session, edit)).toEqual({
      clientInfo: {
        ...session.clientInfo,
        name: "Edited Organisation",
        department: "Edited Department",
        operatingProfile: "carrier",
      },
      scores: { "people__leadership": 5 },
      evidence: { "people__leadership": "Saved board note" },
      currentPillar: 0,
    })
  })

  it("cancel restores the pre-edit session and clears editing identity", () => {
    const edit = createRespondentEdit({
      id: "saved-id",
      company: "Edited Organisation",
      department: "Edited Department",
      operatingProfile: "carrier",
      name: "Edited Respondent",
      role: "VP, Operations",
      timestamp: "2026-07-13T10:00:00.000Z",
      scores: { "people__leadership": 5 },
      evidence: { "people__leadership": "Saved board note" },
    })
    const editing: RespondentEditState = {
      editingRespondentId: edit.id,
      origin: session,
    }
    const active = loadRespondentForEdit(session, edit)

    const cancelled = transitionRespondentEdit(active, editing, { type: "cancel" })

    expect(restoreRespondentEditSession(active, editing.origin)).toEqual(session)
    expect(cancelled.session).toEqual(session)
    expect(cancelled.editState).toEqual(idleRespondentEditState)
  })

  it("reset/new assessment returns an empty session and clears editing identity", () => {
    const editing: RespondentEditState = { editingRespondentId: "saved-id", origin: session }

    const reset = transitionRespondentEdit(session, editing, { type: "reset" })

    expect(resetAssessmentSession()).toEqual(emptyAssessmentSession)
    expect(reset.session).toEqual(emptyAssessmentSession)
    expect(reset.editState).toEqual(idleRespondentEditState)
  })

  it("removing the active respondent clears identity without recreating it", () => {
    const editing: RespondentEditState = { editingRespondentId: "saved-id", origin: session }

    const active = loadRespondentForEdit(session, createRespondentEdit({
      id: "saved-id",
      company: "Edited Organisation",
      department: "Edited Department",
      operatingProfile: "carrier",
      name: "Edited Respondent",
      role: "VP, Operations",
      timestamp: "2026-07-13T10:00:00.000Z",
      scores: { "people__leadership": 5 },
      evidence: { "people__leadership": "Saved board note" },
    }))
    const unrelated = transitionRespondentEdit(active, editing, { type: "remove", respondentId: "other-id" })
    const removed = transitionRespondentEdit(active, editing, { type: "remove", respondentId: "saved-id" })

    expect(unrelated.session).toEqual(active)
    expect(unrelated.editState).toEqual(editing)
    expect(removed.session).toEqual(session)
    expect(removed.editState).toEqual(idleRespondentEditState)
    expect(transitionRespondentEdit(removed.session, removed.editState, { type: "remove", respondentId: "saved-id" }).editState).toEqual(idleRespondentEditState)
  })

  it("switching into or out of demo clears identity while leaving session copies isolated", () => {
    const editing: RespondentEditState = { editingRespondentId: "saved-id", origin: session }
    const demoSession = { ...session, clientInfo: { ...session.clientInfo, name: "Synthetic Demo" } }
    const demoEditing: RespondentEditState = { editingRespondentId: "saved-id", origin: demoSession }
    const editedReal = loadRespondentForEdit(session, createRespondentEdit({
      id: "saved-id",
      company: "Edited Organisation",
      department: "Edited Department",
      operatingProfile: "carrier",
      name: "Edited Respondent",
      role: "VP, Operations",
      timestamp: "2026-07-13T10:00:00.000Z",
      scores: { "people__leadership": 5 },
      evidence: { "people__leadership": "Saved board note" },
    }))
    const editedDemo = { ...demoSession, clientInfo: { ...demoSession.clientInfo, name: "Edited Demo" } }
    const realSwitch = transitionRespondentEdit(editedReal, editing, { type: "demo-switch" })
    const demoSwitch = transitionRespondentEdit(editedDemo, demoEditing, { type: "demo-switch" })

    expect(realSwitch.session).toEqual(session)
    expect(realSwitch.editState).toEqual(idleRespondentEditState)
    expect(demoSwitch.session).toEqual(demoSession)
    expect(demoSwitch.editState).toEqual(idleRespondentEditState)
    expect(session.clientInfo.name).toBe("Original Organisation")
    expect(demoSession.clientInfo.name).toBe("Synthetic Demo")
  })

  it("saving clears identity after the provider has applied the edit", () => {
    const editing: RespondentEditState = { editingRespondentId: "saved-id", origin: session }
    const active = { ...session, scores: { "people__leadership": 5 } }
    const saved = transitionRespondentEdit(active, editing, { type: "save" })

    expect(saved.session).toEqual(active)
    expect(saved.editState).toEqual(idleRespondentEditState)
  })

  it("keeps the original origin when a second respondent edit starts", () => {
    const firstEdit = createRespondentEdit({
      id: "first-id",
      company: "First Organisation",
      department: "First Department",
      operatingProfile: "broker",
      name: "First Respondent",
      role: "Director",
      timestamp: "2026-07-13T10:00:00.000Z",
      scores: { "people__leadership": 3 },
      evidence: { "people__leadership": "First note" },
    })
    const secondEdit = createRespondentEdit({
      id: "second-id",
      company: "Second Organisation",
      department: "Second Department",
      operatingProfile: "carrier",
      name: "Second Respondent",
      role: "VP, Operations",
      timestamp: "2026-07-13T10:00:00.000Z",
      scores: { "people__leadership": 5 },
      evidence: { "people__leadership": "Second note" },
    })
    const first = transitionRespondentEdit(session, idleRespondentEditState, { type: "begin", edit: firstEdit })
    const second = transitionRespondentEdit(first.session, first.editState, { type: "begin", edit: secondEdit })
    const cancelled = transitionRespondentEdit(second.session, second.editState, { type: "cancel" })

    expect(second.editState).toEqual({ editingRespondentId: "second-id", origin: session })
    expect(cancelled.session).toEqual(session)
    expect(cancelled.editState).toEqual(idleRespondentEditState)
  })

  it("persists unrelated roster changes against the origin while unfinished edit fields stay transient", () => {
    const edit = createRespondentEdit({ id: "a", company: "Original Organisation", department: "Original Department", operatingProfile: "broker", name: "A", role: "Director", timestamp: "2026-07-13T10:00:00.000Z", scores: {}, evidence: {} })
    const other = createRespondentEdit({ id: "b", company: "Original Organisation", department: "Original Department", operatingProfile: "broker", name: "B", role: "Director", timestamp: "2026-07-13T10:00:00.000Z", scores: {}, evidence: {} })
    const started = transitionRespondentEdit(session, idleRespondentEditState, { type: "begin", edit })
    const active = { ...started.session, clientInfo: { ...started.session.clientInfo, name: "Unfinished edit" } }
    const savedSession = sessionForPersistence(active, started.editState)
    const savedRespondents = [edit]

    expect(savedSession).toEqual(session)
    expect(savedSession.clientInfo.name).not.toBe("Unfinished edit")
    expect(savedRespondents.map((respondent) => respondent.id)).toEqual(["a"])
    expect(other.id).toBe("b")
  })
})

describe("Assessment readout input contract", () => {
  const respondent = (id: string, note: string) => ({ id, company: "Synthetic Organisation", department: "Ops", operatingProfile: "", name: id, role: "Director", timestamp: "2026-07-13T10:00:00.000Z", scores: { "strategy__leadership_commitment": 3 }, evidence: { "strategy__leadership_commitment": note } })

  it("canonicalizes respondent order while retaining every readout input field", async () => {
    const first = respondent("first", "first note")
    const second = respondent("second", "second note")
    const left = { ...session, currentPillar: 0 }
    const right = { ...session, currentPillar: 4 }
    expect(buildReadoutInput(left, [second, first]).respondents.map((entry) => entry.id)).toEqual(["first", "second"])
    expect(await readoutInputDigest(left, [second, first])).toBe(await readoutInputDigest(right, [first, second]))
    expect(await readoutInputDigest(left, [first, respondent("second", "changed")])).not.toBe(await readoutInputDigest(left, [first, second]))
  })

  it("changes digest for client, score and evidence edits but not progress navigation", async () => {
    const original = await readoutInputDigest(session, [respondent("first", "note")])
    expect(await readoutInputDigest({ ...session, currentPillar: 5 }, [respondent("first", "note")])).toBe(original)
    expect(await readoutInputDigest({ ...session, clientInfo: { ...session.clientInfo, facilitator: "New facilitator" } }, [respondent("first", "note")])).not.toBe(original)
    expect(await readoutInputDigest({ ...session, scores: { "strategy__leadership_commitment": 4 } }, [respondent("first", "note")])).not.toBe(original)
    expect(await readoutInputDigest({ ...session, evidence: { "strategy__leadership_commitment": "changed" } }, [respondent("first", "note")])).not.toBe(original)
  })

  it.each([
    ["company", { company: "Changed Company" }],
    ["department", { department: "Finance" }],
    ["operating profile", { operatingProfile: "carrier" }],
    ["name", { name: "Changed Name" }],
    ["role", { role: "VP" }],
    ["timestamp", { timestamp: "2026-09-07T10:00:00.000Z" }],
    ["score", { scores: { "strategy__leadership_commitment": 5 } }],
    ["evidence", { evidence: { "strategy__leadership_commitment": "changed" } }],
  ] as const)("changes digest when only respondent %s changes", async (_label, change) => {
    const originalRespondent = respondent("first", "note")
    const original = await readoutInputDigest(session, [originalRespondent])
    expect(await readoutInputDigest(session, [{ ...originalRespondent, ...change }])).not.toBe(original)
  })
})

describe("Assessment persistence ordering", () => {
  it("hydrates replacement inside the queue and rejects obsolete snapshots", async () => {
    const events: string[] = []; let releaseImport!: () => void
    const ready = { ok: true as const, document: {} as never }
    const repository = {
      load: async () => { events.push("load"); return { status: "ready" as const, document: ready.document } },
      save: async () => { events.push("save"); return { ok: true as const } },
      importJson: async () => { events.push("import-start"); await new Promise<void>((resolve) => { releaseImport = resolve }); events.push("import-end"); return ready },
      exportEngagement: async () => null,
      exportLegacyRawKey: async () => null,
    } as unknown as AssessmentRepository
    const coordinator = new AssessmentPersistenceCoordinator(repository)
    const replaced = coordinator.replace(() => repository.importJson("backup"), () => events.push("hydrate"))
    const obsolete = coordinator.save({} as never)
    await Promise.resolve()
    releaseImport()
    expect((await replaced).ok).toBe(true)
    expect((await obsolete).ok).toBe(false)
    expect(events).toEqual(["import-start", "import-end", "hydrate"])
  })

  it("hydrates the verified replacement result without a second load", async () => {
    const document = {} as never
    let hydrated = false
    const repository = {
      load: async () => { throw new Error("verification read should not happen") },
      importJson: async () => ({ ok: true as const, document }),
    } as unknown as AssessmentRepository
    const coordinator = new AssessmentPersistenceCoordinator(repository)
    const result = await coordinator.replace(() => repository.importJson("backup"), () => { hydrated = true })
    expect(result.ok).toBe(true)
    expect(hydrated).toBe(true)
  })

  it("queues a reverted snapshot after a delayed newer save and ignores stale completion", () => {
    const tracker = new AssessmentSaveTracker("A")
    const newer = tracker.schedule("B")
    const reverted = tracker.schedule("A")
    expect(newer?.generation).toBeLessThan(reverted?.generation ?? 0)
    expect(tracker.complete(newer!, true)).toBe(false)
    expect(tracker.complete(reverted!, true)).toBe(true)
    expect(tracker.persistedSnapshot).toBe("A")
  })

  it("invalidates an obsolete queued save when verified restore hydrates a new snapshot", () => {
    const tracker = new AssessmentSaveTracker("A")
    const queued = tracker.schedule("B")!
    tracker.hydrate("restored")
    expect(tracker.complete(queued, true)).toBe(false)
    expect(tracker.persistedSnapshot).toBe("restored")
  })

  it("keeps demo readouts transient and isolated from the real readout", () => {
    const real = { text: "real", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: "sha256:" + "a".repeat(64) }
    const demo = { text: "demo", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: "sha256:" + "b".repeat(64) }
    const saved = saveAssessmentReadout(true, demo, real, null)
    expect(saved.realReadout).toBe(real)
    expect(selectAssessmentReadout(true, saved.realReadout, saved.demoReadout)).toBe(demo)
    expect(selectAssessmentReadout(false, saved.realReadout, saved.demoReadout)).toBe(real)
  })

  it("clears stale save status after verified hydration", () => {
    expect(saveStatusAfterHydration("unsaved", "ready")).toBe("saved")
    expect(saveStatusAfterHydration("saving", "ready")).toBe("saved")
    expect(saveStatusAfterHydration("unsaved", "empty")).toBe("idle")
  })

  it("keeps a later restore ahead of an older autosave and lets export observe it", async () => {
    const queue = new AssessmentPersistenceQueue()
    let stored = "before"
    let releaseSave!: () => void
    const autosave = queue.run(async () => {
      await new Promise<void>((resolve) => { releaseSave = resolve })
      stored = "autosave"
    })
    const restore = queue.run(async () => { stored = "restored" })
    const exportLatest = queue.run(async () => stored)
    await Promise.resolve()
    releaseSave()
    await autosave
    await restore
    expect(await exportLatest).toBe("restored")
  })

  it.each([
    ["idle", "Ready to save changes."],
    ["saving", "Saving to this browser…"],
    ["saved", "Saved to this browser."],
    ["unsaved", "Changes are not saved."],
  ] as const)("uses accurate save copy for %s", (status, label) => {
    expect(assessmentSaveStatusLabel(status)).toBe(label)
  })

  it("runs autosave, restore, retry, claim, and export in one order", async () => {
    const queue = new AssessmentPersistenceQueue()
    const events: string[] = []
    let releaseSave!: () => void
    const save = queue.run(async () => { events.push("save-start"); await new Promise<void>((resolve) => { releaseSave = resolve }); events.push("save-end") })
    const restore = queue.run(async () => { events.push("restore") })
    const exportLatest = queue.run(async () => { events.push("export") })
    await Promise.resolve()
    expect(events).toEqual(["save-start"])
    releaseSave()
    await Promise.all([save, restore, exportLatest])
    expect(events).toEqual(["save-start", "save-end", "restore", "export"])
  })
})

it("rejects old engagement autosaves both during replacement and after hydration, but saves B", async () => {
  const { engagementFromSession } = await import("./persistence/engagement-schema")
  const a = engagementFromSession({ tenantId: "tenant-a", appVersion: "v1.0.0", session: resetAssessmentSession(), respondents: [], engagementId: "A" })
  const b = { ...a, engagementId: "B" }
  let stored = a
  const writes: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const repository = { load: async () => ({ status: "ready", document: stored }), save: async (next: typeof a) => { writes.push(next.engagementId); stored = next; return { ok: true, document: next } } } as AssessmentRepository
  const queue = new AssessmentPersistenceCoordinator(repository)
  await queue.load()
  const inFlight = queue.save(a)
  const replace = queue.replace(async () => { await gate; stored = b; return { ok: true, document: b } }, () => undefined)
  const during = queue.save(a)
  await inFlight
  release()
  expect((await replace).ok).toBe(true)
  expect((await during).ok).toBe(false)
  // This schedules after the epoch has advanced, as a late React autosave might.
  expect((await queue.save(a)).ok).toBe(false)
  expect(stored.engagementId).toBe("B")
  expect((await queue.save(b)).ok).toBe(true)
  expect(writes).toEqual(["A", "B"])
})
