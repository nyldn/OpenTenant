import { describe, expect, it } from "vitest"
import { LocalAssessmentRepository, STALE_ENGAGEMENT } from "./assessment-repository"
import { ENGAGEMENT_SCHEMA_VERSION, type EngagementDocument } from "./engagement-schema"

function storage() { const map = new Map<string, string>(); return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) } }
function document(tenantId = "tenant-a"): EngagementDocument { const at = "2026-09-06T00:00:00.000Z"; return { schemaVersion: ENGAGEMENT_SCHEMA_VERSION, appVersion: "v1.0.0", tenantId, engagementId: "eng_1", brandLabel: null, session: { clientInfo: { name: "Example Organisation", department: "Ops", operatingProfile: "", date: "", facilitator: "" }, scores: {}, evidence: {}, currentPillar: 0 }, respondents: [], legacyClaim: null, readout: null, createdAt: at, updatedAt: at } }
const locks = { request: async (_name: string, _options: { mode: "exclusive" }, callback: () => Promise<unknown>) => callback() }
const v26Session = JSON.stringify({ clientInfo: { name: "Synthetic Organisation", department: "Ops", operatingProfile: "", date: "", facilitator: "" }, scores: {}, evidence: {}, currentPillar: 0 })
const v26RespondentWithoutContext = JSON.stringify([{ id: "respondent-1", name: "Synthetic Respondent", role: "Director", timestamp: "2026-09-06T00:00:00.000Z", scores: {}, evidence: {} }])
function v1Engagement(overrides: Record<string, unknown> = {}) { return { schemaVersion: 1, appVersion: "v1.0.0", engagementId: "legacy-engagement-42", client: { name: "Synthetic Organisation" }, brandLabel: null, respondents: [], scores: {}, sessionState: null, generatedReadout: null, createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z", ...overrides } }

function legacyStorage() { const s = storage(); s.map.set("assessment_session_v26", v26Session); return s }

describe("LocalAssessmentRepository", () => {
  it("does not mutate storage when the initial clear read fails", async () => {
    const calls: string[] = []
    const failing = { getItem: () => { throw new Error("read") }, setItem: () => { calls.push("set") }, removeItem: () => { calls.push("remove") } }
    const result = await new LocalAssessmentRepository("tenant-a", failing).clear()
    expect(result.ok).toBe(false)
    expect(calls).toEqual([])
  })
  it("verifies exact active bytes after clear rollback", async () => {
    const base = storage(); const raw = JSON.stringify(document()); base.map.set("assessment_engagement_v2:tenant-a", raw)
    const failing = { ...base, removeItem: (key: string) => { base.map.delete(key); throw new Error("remove") } }
    const result = await new LocalAssessmentRepository("tenant-a", failing).clear()
    expect(result.ok).toBe(false)
    expect(base.map.get("assessment_engagement_v2:tenant-a")).toBe(raw)
  })
  it.each([
    ["save", async (base: ReturnType<typeof storage>) => new LocalAssessmentRepository("tenant-a", { ...base, setItem: (key: string, value: string) => { if (key === "assessment_engagement_v2:tenant-a") throw new Error("write"); base.setItem(key, value) } }).save(document())],
    ["import", async (base: ReturnType<typeof storage>) => new LocalAssessmentRepository("tenant-a", { ...base, setItem: (key: string, value: string) => { if (key === "assessment_engagement_v2:tenant-a") throw new Error("write"); base.setItem(key, value) } }).importJson(JSON.stringify(document()))],
  ])("preserves the prior active value on %s write failure", async (_label, run) => {
    const base = storage(); const raw = JSON.stringify(document()); base.setItem("assessment_engagement_v2:tenant-a", raw)
    const result = await run(base)
    expect(result).toMatchObject({ ok: false, code: "storage_failure" })
    expect(base.map.get("assessment_engagement_v2:tenant-a")).toBe(raw)
    expect(base.map.get("assessment_engagement_v2:tenant-a:backup")).toBe(raw)
  })
  it("rolls back a failed replacement when there was no prior active value", async () => {
    const base = storage(); let replaced = false; const failing = { ...base, setItem: (key: string, value: string) => { if (key === "assessment_engagement_v2:tenant-a") { replaced = true; base.map.set(key, "mismatched") } else base.setItem(key, value) }, getItem: (key: string) => key === "assessment_engagement_v2:tenant-a" && replaced ? "mismatched" : base.getItem(key) }
    const result = await new LocalAssessmentRepository("tenant-a", failing).importJson(JSON.stringify(document()))
    expect(result).toMatchObject({ ok: false, code: "storage_failure" })
    expect(base.map.has("assessment_engagement_v2:tenant-a")).toBe(false)
  })
  it("keeps an unrelated backup when restore replacement write fails", async () => {
    const base = storage(); const raw = JSON.stringify(document()); base.setItem("assessment_engagement_v2:tenant-a:backup", raw)
    const failing = { ...base, setItem: (key: string, value: string) => { if (key === "assessment_engagement_v2:tenant-a") throw new Error("write"); base.setItem(key, value) } }
    const result = await new LocalAssessmentRepository("tenant-a", failing).restoreBackup()
    expect(result).toMatchObject({ ok: false, code: "storage_failure" })
    expect(base.map.get("assessment_engagement_v2:tenant-a:backup")).toBe(raw)
    expect(base.map.has("assessment_engagement_v2:tenant-a")).toBe(false)
  })
  it("preserves the active value when replacement readback is mismatched", async () => {
    const base = storage(); const previous = JSON.stringify(document()); base.setItem("assessment_engagement_v2:tenant-a", previous); let replacing = false
    const failing = { ...base, setItem: (key: string, value: string) => { if (key === "assessment_engagement_v2:tenant-a") replacing = true; base.setItem(key, value) }, getItem: (key: string) => key === "assessment_engagement_v2:tenant-a" && replacing ? "mismatched" : base.getItem(key) }
    const result = await new LocalAssessmentRepository("tenant-a", failing).save({ ...document(), updatedAt: "2026-09-07T00:00:00.000Z" })
    expect(result).toMatchObject({ ok: false, code: "storage_failure" })
    expect(base.map.get("assessment_engagement_v2:tenant-a")).toBe(previous)
  })
  it("reports backup and recovery preservation write failures without replacing active data", async () => {
    const base = storage(); const previous = JSON.stringify(document()); base.setItem("assessment_engagement_v2:tenant-a", previous)
    const failing = { ...base, setItem: (key: string, value: string) => { if (key.includes(":backup") || key.includes(":recovery:")) throw new Error("preserve"); base.setItem(key, value) } }
    const result = await new LocalAssessmentRepository("tenant-a", failing).save({ ...document(), updatedAt: "2026-09-07T00:00:00.000Z" })
    expect(result).toMatchObject({ ok: false, code: "storage_failure" })
    expect(base.map.get("assessment_engagement_v2:tenant-a")).toBe(previous)
  })
  it("does not replace malformed active bytes when recovery preservation fails or reads back differently", async () => {
    for (const mode of ["write", "readback"] as const) {
      const base = storage(); const activeKey = "assessment_engagement_v2:tenant-a"; const malformed = "{malformed-active"
      base.map.set(activeKey, malformed)
      let activeWrites = 0
      const failing = {
        ...base,
        setItem: (key: string, value: string) => {
          if (key === activeKey) activeWrites += 1
          if (key.includes(":recovery:") && mode === "write") throw new Error("recovery write")
          base.map.set(key, value)
        },
        getItem: (key: string) => key.includes(":recovery:") && mode === "readback" ? "different" : base.getItem(key),
      }
      expect(await new LocalAssessmentRepository("tenant-a", failing).save(document())).toMatchObject({ ok: false, code: "storage_failure" })
      expect(activeWrites).toBe(0)
      expect(base.map.get(activeKey)).toBe(malformed)
    }
  })
  it("does not replace valid active bytes when backup readback differs", async () => {
    const base = storage(); const activeKey = "assessment_engagement_v2:tenant-a"; const previous = JSON.stringify(document())
    base.map.set(activeKey, previous)
    let activeWrites = 0
    const failing = { ...base, setItem: (key: string, value: string) => { if (key === activeKey) activeWrites += 1; base.map.set(key, value) }, getItem: (key: string) => key.endsWith(":backup") ? "different" : base.getItem(key) }
    expect(await new LocalAssessmentRepository("tenant-a", failing).save({ ...document(), updatedAt: "2026-09-07T00:00:00.000Z" })).toMatchObject({ ok: false, code: "storage_failure" })
    expect(activeWrites).toBe(0)
    expect(base.map.get(activeKey)).toBe(previous)
  })
  it("reports a clear write failure without creating an active value", async () => {
    const base = storage(); const failing = { ...base, removeItem: () => { throw new Error("remove") } }
    const result = await new LocalAssessmentRepository("tenant-a", failing).clear()
    expect(result).toMatchObject({ ok: false, code: "storage_failure" })
    expect(base.map.has("assessment_engagement_v2:tenant-a")).toBe(false)
  })
  it("round-trips a tenant-scoped v2 document and separates tenants", async () => { const s = storage(); const a = new LocalAssessmentRepository("tenant-a", s); const b = new LocalAssessmentRepository("tenant-b", s); const doc = document(); expect((await a.save(doc)).ok).toBe(true); expect((await a.load()).status).toBe("ready"); expect((await b.load()).status).toBe("empty"); expect(s.map.has("assessment_engagement_v2:tenant-a")).toBe(true) })
  it("rejects cross-tenant imports before storage mutation", async () => { const s = storage(); const repo = new LocalAssessmentRepository("tenant-b", s); const result = await repo.importJson(JSON.stringify(document("tenant-a"))); expect(result.ok).toBe(false); expect(s.map.size).toBe(0) })
  it("reports malformed active data instead of treating it as empty", async () => { const s = storage(); s.setItem("assessment_engagement_v2:tenant-a", "{bad"); const result = await new LocalAssessmentRepository("tenant-a", s).load(); expect(result.status).toBe("invalid") })
  it("preserves exact active bytes in a recovery key before replacement", async () => { const s = storage(); const raw = "{\"malformed\":true}"; s.setItem("assessment_engagement_v2:tenant-a", raw); const result = await new LocalAssessmentRepository("tenant-a", s).save(document()); expect(result.ok).toBe(true); expect([...s.map.entries()].some(([key, value]) => key.includes(":recovery:") && value === raw)).toBe(true) })
  it("fails closed when Web Locks are unavailable", async () => { const s = storage(); s.setItem("assessment_session_v26", JSON.stringify({ clientInfo: { name: "Synthetic" } })); const result = await new LocalAssessmentRepository("tenant-a", s).claimLegacy("v26"); expect(result).toMatchObject({ ok: false, code: "legacy_exclusion_unavailable" }); expect(s.map.has("assessment_legacy_claim_v1")).toBe(false) })
  it("serializes first claims across tenants through one exclusive lock", async () => {
    // Web Locks are exclusive per name, as in browsers.
    const s = legacyStorage(); const held = new Set<string>(); const waiters = new Map<string, Array<() => void>>()
    const contentionLocks = { request: async (name: string, _options: { mode: "exclusive" }, callback: () => Promise<unknown>) => { while (held.has(name)) await new Promise<void>((resolve) => waiters.set(name, [...(waiters.get(name) ?? []), resolve])); held.add(name); try { return await callback() } finally { held.delete(name); waiters.get(name)?.shift()?.() } } }
    const first = new LocalAssessmentRepository("tenant-a", s, contentionLocks).claimLegacy("v26")
    const second = new LocalAssessmentRepository("tenant-b", s, contentionLocks).claimLegacy("v26")
    const results = await Promise.all([first, second])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    expect((await new LocalAssessmentRepository("tenant-b", s, contentionLocks).load()).status).toBe("legacy_claimed_elsewhere")
  })
  it("reports storage failures from inside an acquired lock as storage failures", async () => {
    const calls: string[] = []
    const failing = { getItem: (key: string) => { calls.push(`get:${key}`); if (key === "assessment_legacy_claim_v1") return null; throw new Error("read") }, setItem: () => { calls.push("set") }, removeItem: () => { calls.push("remove") } }
    const result = await new LocalAssessmentRepository("tenant-a", failing, locks).claimLegacy("v26")
    expect(result).toMatchObject({ ok: false, code: "storage_failure" })
    if (!result.ok) expect(result.code).not.toBe("legacy_exclusion_unavailable")
    expect(calls).toEqual(["get:assessment_legacy_claim_v1", "get:assessment_session_v26"])
  })
  it("pins malformed legacy bytes before conversion and permits only the owning tenant to recover them", async () => {
    const s = storage(); const malformed = "{bad"; s.map.set("assessment_session_v26", malformed)
    const owner = new LocalAssessmentRepository("tenant-a", s, locks)
    const result = await owner.claimLegacy("v26")
    expect(result).toMatchObject({ ok: false, code: "invalid" })
    const receipt = JSON.parse(s.map.get("assessment_legacy_claim_v1")!)
    expect(receipt.status).toBe("pending")
    expect(await owner.exportLegacyRawKey("assessment_session_v26")).toBe(malformed)
    expect((await new LocalAssessmentRepository("tenant-b", s, locks).load()).status).toBe("legacy_claimed_elsewhere")
    expect(await new LocalAssessmentRepository("tenant-b", s, locks).exportLegacyRawKey("assessment_session_v26")).toBeNull()
  })
  it("rejects marker-free import while this tenant has a pending claim", async () => {
    const s = storage(); s.map.set("assessment_session_v26", "{bad")
    const repo = new LocalAssessmentRepository("tenant-a", s, locks)
    await repo.claimLegacy("v26")
    const result = await repo.importJson(JSON.stringify(document()))
    expect(result).toMatchObject({ ok: false, code: "conflict" })
    expect((await repo.load()).status).toBe("legacy_claim_pending")
    expect(s.map.has("assessment_engagement_v2:tenant-a")).toBe(false)
  })
  it("does not export an empty, pending, or unverified claim document", async () => { const s = storage(); const repo = new LocalAssessmentRepository("tenant-a", s); expect(await repo.exportEngagement()).toBeNull(); s.setItem("assessment_legacy_claim_v1", JSON.stringify({ schemaVersion: 1, claimId: "", tenantId: "tenant-a", source: "v26", sourceDigests: { assessment_session_v26: null, assessment_respondents_v26: null, assessment_engagement_v1: null }, status: "pending", targetDocumentDigest: null, createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z" })); expect(await repo.exportEngagement()).toBeNull() })
  it("preserves a v1 engagement ID while using a separate claim ID", async () => { const s = storage(); s.map.set("assessment_engagement_v1", JSON.stringify(v1Engagement({ generatedReadout: "old readout" }))); const result = await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy("engagement_v1"); expect(result.ok).toBe(true); if (result.ok && result.document) { expect(result.document.engagementId).toBe("legacy-engagement-42"); expect(result.document.legacyClaim?.claimId).not.toBe(result.document.engagementId) } })
  it("preserves empty and whitespace v1 client names without trimming", async () => {
    for (const name of ["", "  Synthetic  "]) {
      const s = storage(); s.map.set("assessment_engagement_v1", JSON.stringify(v1Engagement({ client: { name } })))
      const result = await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy("engagement_v1")
      expect(result.ok).toBe(true)
      if (result.ok && result.document) expect(result.document.session.clientInfo.name).toBe(name)
    }
  })
  it("requires the complete v1 identity, timestamp and collection shape", async () => {
    const missingSchema = v1Engagement(); delete (missingSchema as Record<string, unknown>).schemaVersion
    const nullScores = v1Engagement({ scores: null })
    const nullRespondents = v1Engagement({ respondents: null })
    for (const input of [missingSchema, nullScores, nullRespondents]) {
      const s = storage(); s.map.set("assessment_engagement_v1", JSON.stringify(input))
      expect((await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy("engagement_v1")).ok).toBe(false)
    }
  })
  it("converts missing, null, minimal, and full v1 session states", async () => {
    const full = { clientInfo: { name: "Synthetic Organisation", department: "Ops", operatingProfile: "", date: "", facilitator: "" }, scores: { "strategy__ai_vision": 3 }, evidence: { "strategy__ai_vision": "note" }, currentPillar: 2 }
    for (const sessionState of [undefined, null, { currentPillar: 2 }, full]) {
      const legacy = v1Engagement({ ...(sessionState === undefined ? {} : { sessionState }), scores: {} })
      if (sessionState === undefined) delete (legacy as Record<string, unknown>).sessionState
      const s = storage(); s.map.set("assessment_engagement_v1", JSON.stringify(legacy))
      const result = await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy("engagement_v1")
      expect(result.ok).toBe(true)
      if (result.ok && result.document) expect(result.document.session.currentPillar).toBe(sessionState === undefined || sessionState === null ? 0 : 2)
    }
  })
  it("rejects a v1 respondent score-index conflict", async () => {
    const respondent = { id: "r1", name: "Respondent", role: "Director", timestamp: "2026-09-06T00:00:00.000Z", scores: { "strategy__ai_vision": 4 }, evidence: {} }
    const s = storage(); s.map.set("assessment_engagement_v1", JSON.stringify(v1Engagement({ respondents: [respondent], scores: { r1: { "strategy__ai_vision": 3 } } })))
    expect((await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy("engagement_v1")).ok).toBe(false)
  })
  it("rejects an oversized legacy source before parsing or conversion", async () => {
    const oversized = JSON.stringify(v1Engagement({ generatedReadout: "x".repeat(1024 * 1024) }))
    const s = storage(); s.map.set("assessment_engagement_v1", oversized)
    const result = await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy("engagement_v1")
    expect(result).toMatchObject({ ok: false, code: "invalid" })
    expect([...s.map.keys()].some((key) => key.includes(":target:"))).toBe(false)
    expect(JSON.parse(s.map.get("assessment_legacy_claim_v1")!).status).toBe("pending")
  })
  it("converts respondents-only v26 data with an empty session and missing context defaults", async () => { const s = storage(); s.map.set("assessment_respondents_v26", v26RespondentWithoutContext); const result = await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy("v26"); expect(result.ok).toBe(true); if (result.ok && result.document) { expect(result.document.session).toMatchObject({ clientInfo: { name: "" }, scores: {}, evidence: {}, currentPillar: 0 }); expect(result.document.respondents[0]).toMatchObject({ company: "", department: "", operatingProfile: "" }) } })
  it("keeps a session-only v26 source valid and blocks a corrupt present counterpart", async () => { const sessionOnly = storage(); sessionOnly.map.set("assessment_session_v26", v26Session); expect((await new LocalAssessmentRepository("tenant-a", sessionOnly, locks).claimLegacy("v26")).ok).toBe(true); const corruptPair = storage(); corruptPair.map.set("assessment_session_v26", v26Session); corruptPair.map.set("assessment_respondents_v26", "{bad"); const result = await new LocalAssessmentRepository("tenant-a", corruptPair, locks).claimLegacy("v26"); expect(result.ok).toBe(false); expect([...corruptPair.map.keys()].some((key) => key.includes(":target:"))).toBe(false); expect(JSON.parse(corruptPair.map.get("assessment_legacy_claim_v1")!).status).toBe("pending") })
  it("exports a completed claim as a marker-free backup and only authorized raw bytes", async () => { const s = legacyStorage(); const raw = s.map.get("assessment_session_v26")!; const repo = new LocalAssessmentRepository("tenant-a", s, locks); expect((await repo.claimLegacy("v26")).ok).toBe(true); const backup = await repo.exportEngagement(); expect(backup).toBeTruthy(); expect(JSON.parse(backup!).legacyClaim).toBeNull(); expect(await repo.exportLegacyRawKey("assessment_session_v26")).toBe(raw); expect(await repo.exportLegacyRawKey("assessment_respondents_v26")).toBeNull(); const imported = storage(); const otherRepo = new LocalAssessmentRepository("tenant-a", imported, undefined); expect((await otherRepo.importJson(backup!)).ok).toBe(true); expect((await otherRepo.load()).status).toBe("ready") })
  it("clears the completed marker on edit, restores the pinned target, and edits again", async () => {
    const s = legacyStorage(); const repo = new LocalAssessmentRepository("tenant-a", s, locks); const claimed = await repo.claimLegacy("v26")
    expect(claimed.ok).toBe(true); if (!claimed.ok || !claimed.document) return
    const edited = { ...claimed.document, legacyClaim: null }
    expect((await repo.save(edited)).ok).toBe(true)
    const markerFree = await repo.load(); expect(markerFree.status).toBe("ready"); if (markerFree.status !== "ready") return
    expect(markerFree.document.legacyClaim).toBeNull()
    const restored = await repo.restoreBackup(); expect(restored.ok).toBe(true); if (!restored.ok || !restored.document) return
    expect(restored.document.legacyClaim).not.toBeNull()
    expect((await repo.save({ ...restored.document, legacyClaim: null })).ok).toBe(true)
    const editedAgain = await repo.load(); expect(editedAgain.status).toBe("ready"); if (editedAgain.status === "ready") expect(editedAgain.document.legacyClaim).toBeNull()
  })
  it("rejects a valid v1 client/session conflict without writing a target", async () => { const s = storage(); s.map.set("assessment_engagement_v1", JSON.stringify(v1Engagement({ client: { name: "Top" }, sessionState: { clientInfo: { name: "Different", department: "", operatingProfile: "", date: "", facilitator: "" }, scores: {}, evidence: {}, currentPillar: 0 } }))); const result = await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy("engagement_v1"); expect(result.ok).toBe(false); expect([...s.map.keys()].some((key) => key.includes(":target:") || key.startsWith("assessment_engagement_v2:") && !key.endsWith(":backup"))).toBe(false) })
  it.each([
    ["v26", () => { const s = legacyStorage(); s.map.set("assessment_session_v26", ""); return s }],
    ["v26 field", () => { const s = legacyStorage(); s.map.set("assessment_session_v26", JSON.stringify({ clientInfo: { name: "Synthetic Organisation", department: "Ops", operatingProfile: "", date: "", facilitator: "" }, scores: {}, evidence: {}, currentPillar: "not-an-integer" })); return s }],
    ["v1 appVersion", () => { const s = storage(); s.map.set("assessment_engagement_v1", JSON.stringify(v1Engagement({ appVersion: 7 }))); return s }],
  ])("rejects malformed recognized legacy input (%s) without a target", async (_label, makeStorage) => {
    const s = makeStorage(); const result = await new LocalAssessmentRepository("tenant-a", s, locks).claimLegacy(_label === "v1 appVersion" ? "engagement_v1" : "v26")
    expect(result.ok).toBe(false)
    expect([...s.map.keys()].some((key) => key.includes(":target:"))).toBe(false)
  })
  it("resumes a pinned claim after completion failure without regenerating the target", async () => {
    const original = legacyStorage(); let claimWrites = 0
    const failing = { ...original, setItem: (key: string, value: string) => { if (key === "assessment_legacy_claim_v1") { claimWrites += 1; if (claimWrites === 3) throw new Error("complete write") } original.map.set(key, value) } }
    const first = await new LocalAssessmentRepository("tenant-a", failing, locks).claimLegacy("v26")
    expect(first.ok).toBe(false)
    const targetKey = [...original.map.keys()].find((key) => key.includes(":target:")) as string
    const pinnedTarget = original.map.get(targetKey)
    expect(pinnedTarget).toBeTruthy()
    expect((await new LocalAssessmentRepository("tenant-a", original, locks).load()).status).toBe("legacy_claim_pending")
    const resumed = await new LocalAssessmentRepository("tenant-a", original, locks).claimLegacy("v26")
    expect(resumed.ok).toBe(true)
    expect(original.map.get(targetKey)).toBe(pinnedTarget)
  })
  it("retries target-unset pending receipts with absent, conflicting, and interrupted target state", async () => {
    const targetKey = (s: ReturnType<typeof storage>) => [...s.map.keys()].find((key) => key.includes(":target:"))

    const absent = legacyStorage()
    const failTarget = { ...absent, setItem: (key: string, value: string) => { if (key.includes(":target:")) throw new Error("target write"); absent.map.set(key, value) } }
    expect((await new LocalAssessmentRepository("tenant-a", failTarget, locks).claimLegacy("v26")).ok).toBe(false)
    const absentReceipt = JSON.parse(absent.map.get("assessment_legacy_claim_v1")!)
    expect(absentReceipt.targetDocumentDigest).toBeNull()
    const absentRetry = await new LocalAssessmentRepository("tenant-a", absent, locks).claimLegacy("v26")
    expect(absentRetry.ok).toBe(true)
    if (absentRetry.ok) expect(absentRetry.document?.legacyClaim?.claimId).toBe(absentReceipt.claimId)

    const conflicting = legacyStorage()
    const failConflictTarget = { ...conflicting, setItem: (key: string, value: string) => { if (key.includes(":target:")) throw new Error("target write"); conflicting.map.set(key, value) } }
    expect((await new LocalAssessmentRepository("tenant-a", failConflictTarget, locks).claimLegacy("v26")).ok).toBe(false)
    const unrelatedActive = JSON.stringify(document())
    conflicting.map.set("assessment_engagement_v2:tenant-a", unrelatedActive)
    expect(await new LocalAssessmentRepository("tenant-a", conflicting, locks).claimLegacy("v26")).toMatchObject({ ok: false, code: "conflict" })
    expect(conflicting.map.get("assessment_engagement_v2:tenant-a")).toBe(unrelatedActive)

    const interrupted = legacyStorage(); let receiptWrites = 0
    const failPinnedReceipt = { ...interrupted, setItem: (key: string, value: string) => { if (key === "assessment_legacy_claim_v1" && ++receiptWrites === 2) throw new Error("pinned receipt write"); interrupted.map.set(key, value) } }
    expect((await new LocalAssessmentRepository("tenant-a", failPinnedReceipt, locks).claimLegacy("v26")).ok).toBe(false)
    const interruptedReceipt = JSON.parse(interrupted.map.get("assessment_legacy_claim_v1")!)
    expect(interruptedReceipt.targetDocumentDigest).toBeNull()
    const interruptedTargetKey = targetKey(interrupted)
    expect(interruptedTargetKey).toBeTruthy()
    const interruptedTarget = interrupted.map.get(interruptedTargetKey!)
    let retryTargetWrites = 0
    const observeRetry = { ...interrupted, setItem: (key: string, value: string) => { if (key === interruptedTargetKey) retryTargetWrites += 1; interrupted.map.set(key, value) } }
    const interruptedRetry = await new LocalAssessmentRepository("tenant-a", observeRetry, locks).claimLegacy("v26")
    expect(interruptedRetry.ok).toBe(true)
    expect(retryTargetWrites).toBe(0)
    expect(interrupted.map.get(interruptedTargetKey!)).toBe(interruptedTarget)
    if (interruptedRetry.ok) expect(interruptedRetry.document?.legacyClaim?.claimId).toBe(interruptedReceipt.claimId)
  })
  it("rejects a pending retry when its pinned target is missing", async () => {
    const original = legacyStorage(); let claimWrites = 0
    const failing = { ...original, setItem: (key: string, value: string) => { if (key === "assessment_legacy_claim_v1") { claimWrites += 1; if (claimWrites === 3) throw new Error("complete write") } original.map.set(key, value) } }
    expect((await new LocalAssessmentRepository("tenant-a", failing, locks).claimLegacy("v26")).ok).toBe(false)
    const targetKey = [...original.map.keys()].find((key) => key.includes(":target:")) as string; original.map.delete(targetKey)
    expect((await new LocalAssessmentRepository("tenant-a", original, locks).claimLegacy("v26")).ok).toBe(false)
  })
  it("rejects a pending retry after the pinned source changes", async () => {
    const original = legacyStorage(); let claimWrites = 0
    const failing = { ...original, setItem: (key: string, value: string) => { if (key === "assessment_legacy_claim_v1") { claimWrites += 1; if (claimWrites === 3) throw new Error("complete write") } original.map.set(key, value) } }
    expect((await new LocalAssessmentRepository("tenant-a", failing, locks).claimLegacy("v26")).ok).toBe(false)
    original.map.set("assessment_session_v26", v26Session + " ")
    expect((await new LocalAssessmentRepository("tenant-a", original, locks).claimLegacy("v26")).ok).toBe(false)
  })
  it("rejects receipt source and source-digest mismatches while loading a claim-backed document", async () => {
    const s = legacyStorage(); const repo = new LocalAssessmentRepository("tenant-a", s, locks)
    expect((await repo.claimLegacy("v26")).ok).toBe(true)
    const receiptKey = "assessment_legacy_claim_v1"; const original = JSON.parse(s.map.get(receiptKey)!)
    s.map.set(receiptKey, JSON.stringify({ ...original, source: "engagement_v1", sourceDigests: { assessment_session_v26: null, assessment_respondents_v26: null, assessment_engagement_v1: "sha256:" + "a".repeat(64) } }))
    expect((await repo.load()).status).toBe("invalid")
    s.map.set(receiptKey, JSON.stringify({ ...original, sourceDigests: { ...original.sourceDigests, assessment_session_v26: "sha256:" + "b".repeat(64) } }))
    expect((await repo.load()).status).toBe("invalid")
  })
  it("rejects a pinned retry target whose source disagrees with the pending receipt", async () => {
    const original = legacyStorage(); let claimWrites = 0
    const failing = { ...original, setItem: (key: string, value: string) => { if (key === "assessment_legacy_claim_v1") { claimWrites += 1; if (claimWrites === 3) throw new Error("complete write") } original.map.set(key, value) } }
    expect((await new LocalAssessmentRepository("tenant-a", failing, locks).claimLegacy("v26")).ok).toBe(false)
    const targetKey = [...original.map.keys()].find((key) => key.includes(":target:")) as string
    const target = JSON.parse(original.map.get(targetKey)!)
    target.legacyClaim.source = "engagement_v1"
    target.legacyClaim.sourceDigests.assessment_engagement_v1 = "sha256:" + "c".repeat(64)
    const targetRaw = JSON.stringify(target); original.map.set(targetKey, targetRaw)
    const targetDigestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(targetRaw))
    const targetDigest = `sha256:${Array.from(new Uint8Array(targetDigestBytes), (value) => value.toString(16).padStart(2, "0")).join("")}`
    const receipt = JSON.parse(original.map.get("assessment_legacy_claim_v1")!)
    original.map.set("assessment_legacy_claim_v1", JSON.stringify({ ...receipt, targetDocumentDigest: targetDigest }))
    expect((await new LocalAssessmentRepository("tenant-a", original, locks).claimLegacy("v26")).ok).toBe(false)
  })
  it("leaves a pinned claim pending when complete receipt readback fails", async () => {
    const original = legacyStorage(); let claimWrites = 0; let failCompleteReadback = false
    const failing = {
      ...original,
      getItem: (key: string) => { if (key === "assessment_legacy_claim_v1" && failCompleteReadback) { failCompleteReadback = false; throw new Error("receipt readback") } return original.map.get(key) ?? null },
      setItem: (key: string, value: string) => { if (key === "assessment_legacy_claim_v1") { claimWrites += 1; if (claimWrites === 3) failCompleteReadback = true } original.map.set(key, value) },
    }
    const result = await new LocalAssessmentRepository("tenant-a", failing, locks).claimLegacy("v26")
    expect(result.ok).toBe(false)
    expect((await new LocalAssessmentRepository("tenant-a", original, locks).load()).status).toBe("legacy_claim_pending")
  })
  it("uses the pending retry table for pinned absent, exact and conflicting active values", async () => {
    const source = legacyStorage(); let claimWrites = 0
    const failing = { ...source, setItem: (key: string, value: string) => { if (key === "assessment_legacy_claim_v1") { claimWrites += 1; if (claimWrites === 3) throw new Error("complete write") } source.map.set(key, value) } }
    expect((await new LocalAssessmentRepository("tenant-a", failing, locks).claimLegacy("v26")).ok).toBe(false)
    const targetKey = [...source.map.keys()].find((key) => key.includes(":target:")) as string
    const target = source.map.get(targetKey) as string
    const activeKey = "assessment_engagement_v2:tenant-a"
    source.map.delete(activeKey)
    expect((await new LocalAssessmentRepository("tenant-a", source, locks).claimLegacy("v26")).ok).toBe(true)
    source.map.set("assessment_legacy_claim_v1", source.map.get("assessment_legacy_claim_v1")!.replace('"status":"complete"', '"status":"pending"'))
    source.map.set(activeKey, target)
    expect((await new LocalAssessmentRepository("tenant-a", source, locks).claimLegacy("v26")).ok).toBe(true)
    source.map.set("assessment_legacy_claim_v1", source.map.get("assessment_legacy_claim_v1")!.replace('"status":"complete"', '"status":"pending"'))
    source.map.set(activeKey, JSON.stringify(document()))
    const conflict = await new LocalAssessmentRepository("tenant-a", source, locks).claimLegacy("v26")
    expect(conflict).toMatchObject({ ok: false, code: "conflict" })
    expect(source.map.get(activeKey)).toBe(JSON.stringify(document()))
  })
})

 describe("New engagement backup transaction", () => {
  const activeKey = "assessment_engagement_v2:tenant-a"
  const archiveKey = `${activeKey}:previous-engagement`
  function emptyNext(): EngagementDocument { return { ...document(), engagementId: "eng_B", session: { clientInfo: { name: "", department: "", operatingProfile: "", date: "", facilitator: "" }, scores: {}, evidence: {}, currentPillar: 0 } } }
  it("keeps the exact A backup through B autosaves and a repository reload", async () => {
    const s = storage(); const repo = new LocalAssessmentRepository("tenant-a", s)
    const a = document(); a.session.scores = { "strategy__ai_vision": 3 }
    expect((await repo.save(a)).ok).toBe(true)
    const b = emptyNext()
    expect(await repo.startNewEngagement(a, b)).toEqual({ ok: true, document: b })
    expect(s.map.get(archiveKey)).toBe(JSON.stringify(a))
    b.session.clientInfo.name = "Client B"; b.session.scores = { "strategy__ai_vision": 4 }
    expect((await repo.save(b)).ok).toBe(true)
    expect((await repo.save({ ...b, updatedAt: "2026-09-07T00:00:00.000Z" })).ok).toBe(true)
    const reloaded = new LocalAssessmentRepository("tenant-a", s)
    expect(await reloaded.load()).toEqual({ status: "ready", document: { ...b, updatedAt: "2026-09-07T00:00:00.000Z" } })
    expect(await reloaded.restoreBackup()).toEqual({ ok: true, document: a })
  })
  it.each(["backup-write", "backup-readback", "active-readback"])("keeps A active when %s fails", async mode => {
    const s = storage(); const a = document(); s.map.set(activeKey, JSON.stringify(a))
    let badRead = false
    const failing = { ...s,
      setItem: (key: string, value: string) => { if (key === archiveKey && mode === "backup-write") throw new Error("full"); s.setItem(key, value); if (key === activeKey && value.includes('"eng_B"') && mode === "active-readback") badRead = true },
      getItem: (key: string) => { if (key === archiveKey && mode === "backup-readback") return "corrupt"; if (key === activeKey && badRead) { badRead = false; return "corrupt" }; return s.getItem(key) },
    }
    expect(await new LocalAssessmentRepository("tenant-a", failing).startNewEngagement(a, emptyNext())).toMatchObject({ ok: false, code: "storage_failure" })
    expect(s.map.get(activeKey)).toBe(JSON.stringify(a))
  })
  it("refuses a stale tab's autosave after another tab starts a new engagement", async () => {
    const s = storage(); const tabA = new LocalAssessmentRepository("tenant-a", s, locks); const tabB = new LocalAssessmentRepository("tenant-a", s, locks)
    const a = document(); a.session.scores = { "strategy__ai_vision": 3 }
    expect((await tabA.save(a)).ok).toBe(true)
    const b = emptyNext()
    expect((await tabB.startNewEngagement(a, b)).ok).toBe(true)
    const staleEdit = { ...a, session: { ...a.session, scores: { "strategy__ai_vision": 2 } } }
    const refused = await tabA.save(staleEdit)
    expect(refused).toMatchObject({ ok: false, code: "conflict" })
    expect(refused.ok ? null : refused.errors?.[0]).toBe(STALE_ENGAGEMENT)
    expect(s.map.get(activeKey)).toBe(JSON.stringify(b))
    expect(s.map.get(archiveKey)).toBe(JSON.stringify(a))
  })
  it("swaps engagements on restore so neither A nor B is stranded or erased", async () => {
    const s = storage(); const repo = new LocalAssessmentRepository("tenant-a", s, locks)
    const a = document(); a.session.scores = { "strategy__ai_vision": 3 }
    await repo.save(a)
    const b = emptyNext()
    await repo.startNewEngagement(a, b)
    b.session.clientInfo.name = "Client B"; b.session.scores = { "strategy__ai_vision": 4 }
    expect((await repo.save(b)).ok).toBe(true)
    expect(await repo.restoreBackup()).toEqual({ ok: true, document: a })
    expect(s.map.get(archiveKey)).toBe(JSON.stringify(b))
    expect(await repo.restoreBackup()).toEqual({ ok: true, document: b })
    expect(s.map.get(archiveKey)).toBe(JSON.stringify(a))
  })
  it("refuses a stale origin or a nonempty replacement", async () => {
    const s = storage(); const repo = new LocalAssessmentRepository("tenant-a", s); const a = document()
    await repo.save(a)
    expect(await repo.startNewEngagement({ ...a, engagementId: "obsolete" }, emptyNext())).toMatchObject({ ok: false, code: "conflict" })
    expect(await repo.startNewEngagement(a, { ...emptyNext(), respondents: [{ id: "a" } as never] })).toMatchObject({ ok: false, code: "invalid" })
    expect(s.map.has(archiveKey)).toBe(false)
  })
})
