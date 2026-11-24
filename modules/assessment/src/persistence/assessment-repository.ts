import type { EngagementDocument, LegacyClaim, LegacyClaimReceipt } from "./engagement-schema"
import { browserStorage } from "@opentenant/platform-core/runtime-globals"
import { ENGAGEMENT_SCHEMA_VERSION, MAX_SERIALIZED_BYTES, validateEngagementDocument, validateLegacyClaimReceipt, validateSerializedDocument } from "./engagement-schema"
import { ASSESSMENT_VERSION } from "../runtime"
import type { AssessmentSession } from "../store"
import type { Respondent } from "../types"

export const LEGACY_SESSION_KEY = "assessment_session_v26"
export const LEGACY_RESPONDENTS_KEY = "assessment_respondents_v26"
export const LEGACY_ENGAGEMENT_KEY = "assessment_engagement_v1"
export const LEGACY_CLAIM_KEY = "assessment_legacy_claim_v1"
export const LEGACY_LOCK_NAME = "opentenant:assessment:legacy-claim:v1"

export type RepositoryLoad =
  | { status: "empty" }
  | { status: "ready"; document: EngagementDocument }
  | { status: "invalid"; errors: string[] }
  | { status: "legacy_available"; sources: { v26: boolean; engagement_v1: boolean } }
  | { status: "legacy_claim_pending"; source: "v26" | "engagement_v1" }
  | { status: "legacy_claimed_elsewhere" }

export type RepositoryMutation = { ok: true; document?: EngagementDocument } | { ok: false; code: "storage_failure" | "invalid" | "tenant_mismatch" | "conflict" | "legacy_exclusion_unavailable"; errors?: string[] }
type MutationCode = "storage_failure" | "invalid" | "tenant_mismatch" | "conflict" | "legacy_exclusion_unavailable"
export interface AssessmentRepository {
  load(): Promise<RepositoryLoad>
  save(document: EngagementDocument): Promise<RepositoryMutation>
  startNewEngagement(previous: EngagementDocument, next: EngagementDocument): Promise<RepositoryMutation>
  exportJson(): Promise<string | null>
  exportEngagement(): Promise<string | null>
  exportLegacyRaw(source: "v26" | "engagement_v1"): Promise<string | null>
  exportLegacyRawKey(key: "assessment_session_v26" | "assessment_respondents_v26" | "assessment_engagement_v1"): Promise<string | null>
  importJson(serialized: string): Promise<RepositoryMutation>
  restoreBackup(): Promise<RepositoryMutation>
  clear(): Promise<RepositoryMutation>
  claimLegacy(source: "v26" | "engagement_v1"): Promise<RepositoryMutation>
}
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">
type LocksLike = { request: (name: string, options: { mode: "exclusive" }, callback: () => Promise<unknown>) => Promise<unknown> }
const emptyStorage: StorageLike = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
function defaultStorage(): StorageLike { return browserStorage() ?? emptyStorage }
export const STALE_ENGAGEMENT = "Another tab started a new engagement. Reload to continue with it."
function defaultLocks(): LocksLike | undefined { try { return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : undefined } catch { return undefined } }

async function sha256(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw)
  const buffer = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(buffer), (v) => v.toString(16).padStart(2, "0")).join("")
}
function fail(code: MutationCode, errors?: string[]): RepositoryMutation { return { ok: false, code, ...(errors ? { errors } : {}) } }
function safeError() { return ["Assessment storage operation failed"] }
function json(raw: string): unknown { return JSON.parse(raw) as unknown }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function exact(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value) }
function equalJson(left: unknown, right: unknown) { return canonical(left) === canonical(right) }
function canonicalIso(value: unknown) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value }

export class LocalAssessmentRepository implements AssessmentRepository {
  private readonly activeKey: string
  private readonly backupKey: string
  private readonly engagementBackupKey: string
  private operationQueue = Promise.resolve()
  constructor(private readonly tenantId: string, private readonly storage: StorageLike = defaultStorage(), private readonly locks: LocksLike | undefined = defaultLocks(), private readonly brandLabel: string | null = null) {
    this.activeKey = `assessment_engagement_v2:${encodeURIComponent(tenantId)}`
    this.backupKey = `${this.activeKey}:backup`
    this.engagementBackupKey = `${this.activeKey}:previous-engagement`
  }

  private receiptKeyTarget(claimId: string) { return `${LEGACY_CLAIM_KEY}:target:${claimId}` }
  // The queue orders this tab. The lock orders every tab sharing this tenant's storage.
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const exclusive = () => this.locks ? this.locks.request(`${this.activeKey}:write`, { mode: "exclusive" }, operation) as Promise<T> : operation()
    const run = this.operationQueue.then(exclusive, exclusive); this.operationQueue = run.then(() => undefined, () => undefined); return run
  }
  private read(key: string) { return this.storage.getItem(key) }
  private sources() { return { session: this.read(LEGACY_SESSION_KEY), respondents: this.read(LEGACY_RESPONDENTS_KEY), engagement: this.read(LEGACY_ENGAGEMENT_KEY) } }
  private async receipt(): Promise<{ receipt: LegacyClaimReceipt | null; malformed: boolean; raw: string | null }> {
    let raw: string | null
    try { raw = this.read(LEGACY_CLAIM_KEY) } catch { return { receipt: null, malformed: true, raw: null } }
    if (raw === null) return { receipt: null, malformed: false, raw: null }
    try { const result = validateLegacyClaimReceipt(json(raw)); return result.ok ? { receipt: result.receipt, malformed: false, raw } : { receipt: null, malformed: true, raw } } catch { return { receipt: null, malformed: true, raw } }
  }
  private writeReceiptVerified(receipt: LegacyClaimReceipt, fallbackRaw: string | null): boolean {
    const raw = JSON.stringify(receipt)
    try {
      this.storage.setItem(LEGACY_CLAIM_KEY, raw)
      const readback = this.read(LEGACY_CLAIM_KEY)
      if (readback !== raw || !validateLegacyClaimReceipt(json(readback ?? ""), this.tenantId).ok) throw new Error("receipt readback")
      return true
    } catch {
      try {
        if (fallbackRaw === null) this.storage.removeItem(LEGACY_CLAIM_KEY)
        else this.storage.setItem(LEGACY_CLAIM_KEY, fallbackRaw)
      } catch { /* bounded */ }
      return false
    }
  }

  load(): Promise<RepositoryLoad> { return this.enqueue(() => this.loadNow()) }
  private async loadNow(): Promise<RepositoryLoad> {
    let raw: string | null
    try { raw = this.read(this.activeKey) } catch { return { status: "invalid", errors: safeError() } }
    const receipt = await this.receipt()
    if (raw !== null) {
      const result = validateSerializedDocument(raw, this.tenantId)
      if (!result.ok) return { status: "invalid", errors: result.errors }
      if (receipt.malformed && result.document.legacyClaim !== null) return { status: "invalid", errors: ["Assessment legacy claim receipt is invalid"] }
      if (receipt.receipt?.tenantId === this.tenantId && receipt.receipt.status === "pending") return { status: "legacy_claim_pending", source: receipt.receipt.source }
      if (result.document.legacyClaim) {
        if (!receipt.receipt || receipt.receipt.tenantId !== this.tenantId || receipt.receipt.status !== "complete" || receipt.receipt.claimId !== result.document.legacyClaim.claimId || receipt.receipt.source !== result.document.legacyClaim.source || !equalJson(receipt.receipt.sourceDigests, result.document.legacyClaim.sourceDigests) || receipt.receipt.targetDocumentDigest === null) return { status: "invalid", errors: ["Assessment legacy claim is not complete"] }
        let target: string | null
        try { target = this.read(this.receiptKeyTarget(receipt.receipt.claimId)) } catch { return { status: "invalid", errors: safeError() } }
        if (target === null || `sha256:${await sha256(target)}` !== receipt.receipt.targetDocumentDigest || target !== raw) return { status: "invalid", errors: ["Assessment legacy claim target does not match"] }
      }
      return { status: "ready", document: result.document }
    }
    if (receipt.malformed) return { status: "invalid", errors: ["Assessment legacy claim receipt is invalid"] }
    if (receipt.receipt?.tenantId !== undefined && receipt.receipt.tenantId !== this.tenantId) return { status: "legacy_claimed_elsewhere" }
    if (receipt.receipt?.status === "pending") return { status: "legacy_claim_pending", source: receipt.receipt.source }
    if (receipt.receipt?.status === "complete") return { status: "invalid", errors: ["Assessment legacy claim target is missing"] }
    let sources: ReturnType<LocalAssessmentRepository["sources"]>
    try { sources = this.sources() } catch { return { status: "invalid", errors: safeError() } }
    if (sources.session !== null || sources.respondents !== null || sources.engagement !== null) return { status: "legacy_available", sources: { v26: sources.session !== null || sources.respondents !== null, engagement_v1: sources.engagement !== null } }
    return { status: "empty" }
  }

  save(document: EngagementDocument): Promise<RepositoryMutation> {
    return this.enqueue(async () => {
      // Another tab may have started a new engagement; never autosave a stale one over it.
      let current: string | null
      try { current = this.read(this.activeKey) } catch { return fail("storage_failure", safeError()) }
      const persisted = current === null ? null : validateSerializedDocument(current, this.tenantId)
      if (persisted?.ok && persisted.document.engagementId !== document.engagementId) return fail("conflict", [STALE_ENGAGEMENT])
      return this.saveNow(document)
    })
  }
  startNewEngagement(previous: EngagementDocument, next: EngagementDocument): Promise<RepositoryMutation> {
    return this.enqueue(async () => {
      const validation = validateEngagementDocument(next, this.tenantId)
      if (!validation.ok) return fail("invalid", validation.errors)
      if (previous.engagementId === next.engagementId || next.respondents.length || next.readout !== null || Object.keys(next.session.scores).length || Object.keys(next.session.evidence).length || Object.values(next.session.clientInfo).some(Boolean) || next.session.currentPillar !== 0 || next.legacyClaim !== null) return fail("invalid", ["A new engagement must be empty and have a new identity"])
      const loaded = await this.loadNow()
      if (loaded.status !== "empty" && (loaded.status !== "ready" || loaded.document.engagementId !== previous.engagementId)) return fail("conflict", ["The active engagement changed before replacement"])
      // Save the latest draft/origin before backing it up, even if autosave is pending.
      const saved = await this.saveNow(previous)
      if (!saved.ok) return saved
      const raw = JSON.stringify(previous)
      try {
        // This slot survives ordinary autosaves, which rotate :backup.
        this.storage.setItem(this.engagementBackupKey, raw)
        const readback = this.read(this.engagementBackupKey)
        if (readback !== raw || !validateSerializedDocument(readback, this.tenantId).ok) return fail("storage_failure", safeError())
      } catch { return fail("storage_failure", safeError()) }
      return this.saveNow(validation.document)
    })
  }
  private async saveNow(document: EngagementDocument): Promise<RepositoryMutation> {
    const validation = validateEngagementDocument(document, this.tenantId)
    if (!validation.ok) return fail("invalid", validation.errors)
    try { if (!(await this.claimDocumentIsPinned(validation.document))) return fail("invalid", ["Assessment legacy claim is not backed by its immutable recovery target"]) } catch { return fail("storage_failure", safeError()) }
    const raw = JSON.stringify(validation.document)
    if (new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES) return fail("invalid", ["document exceeds 1 MiB"])
    return this.replace(raw, validation.document)
  }
  private async claimDocumentIsPinned(document: EngagementDocument): Promise<boolean> {
    if (document.legacyClaim === null) return true
    const receipt = await this.receipt()
    if (receipt.malformed || !receipt.receipt || receipt.receipt.tenantId !== this.tenantId || receipt.receipt.status !== "complete" || receipt.receipt.claimId !== document.legacyClaim.claimId || receipt.receipt.source !== document.legacyClaim.source || !equalJson(receipt.receipt.sourceDigests, document.legacyClaim.sourceDigests) || receipt.receipt.targetDocumentDigest === null) return false
    const raw = this.read(this.receiptKeyTarget(document.legacyClaim.claimId))
    if (raw === null || `sha256:${await sha256(raw)}` !== receipt.receipt.targetDocumentDigest) return false
    return raw === JSON.stringify(document)
  }
  private async preserve(raw: string): Promise<boolean> {
    try {
      const valid = validateSerializedDocument(raw, this.tenantId).ok
      const key = valid ? this.backupKey : `${this.activeKey}:recovery:${await sha256(raw)}`
      this.storage.setItem(key, raw)
      const roundTrip = this.storage.getItem(key)
      return roundTrip === raw && (!valid ? `sha256:${await sha256(roundTrip ?? "")}` === `sha256:${await sha256(raw)}` : true)
    } catch { return false }
  }
  private async restoreExact(raw: string | null): Promise<boolean> {
    try {
      if (raw === null) {
        this.storage.removeItem(this.activeKey)
        return this.read(this.activeKey) === null
      }
      this.storage.setItem(this.activeKey, raw)
      const restored = this.read(this.activeKey)
      return restored === raw && `sha256:${await sha256(restored ?? "")}` === `sha256:${await sha256(raw)}`
    } catch { return false }
  }
  private async replace(raw: string, document: EngagementDocument, allowPendingClaim = false): Promise<RepositoryMutation> {
    const receipt = await this.receipt()
    if (!allowPendingClaim && receipt.receipt?.tenantId === this.tenantId && receipt.receipt.status === "pending") return fail("conflict", ["Legacy recovery is pending"])
    let previous: string | null
    try { previous = this.read(this.activeKey) } catch { return fail("storage_failure", safeError()) }
    if (previous !== null && !(await this.preserve(previous))) return fail("storage_failure", safeError())
    try {
      this.storage.setItem(this.activeKey, raw)
      const readback = this.read(this.activeKey)
      const parsed = readback === null ? null : validateSerializedDocument(readback, this.tenantId)
      if (readback !== raw || !parsed?.ok) throw new Error("readback")
      return { ok: true, document }
    } catch {
      try { if (previous === null) { this.storage.removeItem(this.activeKey); if (this.read(this.activeKey) !== null) return fail("storage_failure", safeError()) } else { this.storage.setItem(this.activeKey, previous); if (this.read(this.activeKey) !== previous) return fail("storage_failure", safeError()) } } catch { /* bounded failure below */ }
      return fail("storage_failure", safeError())
    }
  }
  exportJson(): Promise<string | null> { return this.enqueue(async () => { try { return this.read(this.activeKey) } catch { return null } }) }
  exportEngagement(): Promise<string | null> { return this.enqueue(() => this.exportEngagementNow()) }
  private async exportEngagementNow() {
    try {
      const loaded = await this.loadNow()
      if (loaded.status !== "ready") return null
      const result = loaded.document
      if (result.legacyClaim !== null && !(await this.claimDocumentIsPinned(result))) return null
      const doc = result.legacyClaim ? { ...result, legacyClaim: null } : result
      return JSON.stringify(doc)
    } catch { return null }
  }
  exportLegacyRaw(source: "v26" | "engagement_v1"): Promise<string | null> { return this.enqueue(() => this.exportLegacyRawNow(source)) }
  private async exportLegacyRawNow(source: "v26" | "engagement_v1"): Promise<string | null> {
    try {
      const receipt = await this.receipt(); if (receipt.malformed || !receipt.receipt || receipt.receipt.tenantId !== this.tenantId || (receipt.receipt.status !== "complete" && receipt.receipt.status !== "pending")) return null
      const sources = this.sources(); const raw = source === "v26" ? sources.session ?? sources.respondents : sources.engagement; if (raw === null) return null
      const digest = `sha256:${await sha256(raw)}`; const expected = source === "v26" ? (sources.session !== null ? receipt.receipt.sourceDigests.assessment_session_v26 : receipt.receipt.sourceDigests.assessment_respondents_v26) : receipt.receipt.sourceDigests.assessment_engagement_v1
      return digest === expected ? raw : null
    } catch { return null }
  }
  exportLegacyRawKey(key: "assessment_session_v26" | "assessment_respondents_v26" | "assessment_engagement_v1"): Promise<string | null> { return this.enqueue(async () => { try { const receipt = await this.receipt(); if (receipt.malformed || !receipt.receipt || receipt.receipt.tenantId !== this.tenantId || (receipt.receipt.status !== "complete" && receipt.receipt.status !== "pending")) return null; const raw = this.read(key === "assessment_session_v26" ? LEGACY_SESSION_KEY : key === "assessment_respondents_v26" ? LEGACY_RESPONDENTS_KEY : LEGACY_ENGAGEMENT_KEY); const expected = receipt.receipt.sourceDigests[key]; return raw !== null && expected !== null && `sha256:${await sha256(raw)}` === expected ? raw : null } catch { return null } }) }
  importJson(serialized: string): Promise<RepositoryMutation> { return this.enqueue(() => this.importJsonNow(serialized)) }
  private async importJsonNow(serialized: string): Promise<RepositoryMutation> {
    if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) return fail("invalid", ["document exceeds 1 MiB"])
    const result = validateSerializedDocument(serialized, this.tenantId); if (!result.ok) return fail("invalid", result.errors)
    try { if (!(await this.claimDocumentIsPinned(result.document))) return fail("invalid", ["Assessment legacy claim is not backed by its immutable recovery target"]) } catch { return fail("storage_failure", safeError()) }
    return this.replace(JSON.stringify(result.document), result.document)
  }
  restoreBackup(): Promise<RepositoryMutation> { return this.enqueue(() => this.restoreBackupNow()) }
  private async restoreBackupNow(): Promise<RepositoryMutation> {
    try {
      const engagementRaw = this.read(this.engagementBackupKey)
      const raw = engagementRaw ?? this.read(this.backupKey); if (raw === null) return fail("invalid", ["No verified Assessment backup is available"])
      const result = validateSerializedDocument(raw, this.tenantId); if (!result.ok) return fail("invalid", result.errors)
      if (!(await this.claimDocumentIsPinned(result.document))) return fail("invalid", ["Assessment legacy claim is not backed by its immutable recovery target"])
      const displaced = engagementRaw === null ? null : this.read(this.activeKey)
      const restored = await this.replace(raw, result.document)
      // Swap the engagement slot so the engagement this restore displaced stays
      // recoverable; a later restore must never select and overwrite it again.
      if (restored.ok && displaced !== null && displaced !== raw && validateSerializedDocument(displaced, this.tenantId).ok) {
        try { this.storage.setItem(this.engagementBackupKey, displaced) } catch { /* displaced copy remains in :backup */ }
      }
      return restored
    } catch { return fail("storage_failure", safeError()) }
  }
  clear(): Promise<RepositoryMutation> { return this.enqueue(() => this.clearNow()) }
  private async clearNow(): Promise<RepositoryMutation> {
    const receipt = await this.receipt()
    if (receipt.receipt?.tenantId === this.tenantId && receipt.receipt.status === "pending") return fail("conflict", ["Legacy recovery is pending"])
    let previous: string | null
    try { previous = this.read(this.activeKey) } catch { return fail("storage_failure", safeError()) }
    try { if (previous !== null && !(await this.preserve(previous))) return fail("storage_failure", safeError()); this.storage.removeItem(this.activeKey); if (this.read(this.activeKey) !== null) throw new Error("clear readback"); return { ok: true } } catch { await this.restoreExact(previous); return fail("storage_failure", safeError()) }
  }

  claimLegacy(source: "v26" | "engagement_v1"): Promise<RepositoryMutation> { return this.enqueue(() => this.claimLegacyNow(source)) }
  private async claimLegacyNow(source: "v26" | "engagement_v1"): Promise<RepositoryMutation> {
    if (!this.locks) return fail("legacy_exclusion_unavailable", ["Legacy recovery is unavailable in this browser"])
    let callbackEntered = false
    try {
      const outcome = await this.locks.request(LEGACY_LOCK_NAME, { mode: "exclusive" }, async () => {
        callbackEntered = true
        try {
          return await this.claimInsideLock(source)
        } catch {
          return fail("storage_failure", safeError())
        }
      })
      return (outcome as RepositoryMutation) ?? fail("legacy_exclusion_unavailable", safeError())
    } catch {
      return callbackEntered ? fail("storage_failure", safeError()) : fail("legacy_exclusion_unavailable", ["Legacy recovery is unavailable in this browser"])
    }
  }
  private async claimInsideLock(source: "v26" | "engagement_v1"): Promise<RepositoryMutation> {
    const existing = await this.receipt(); if (existing.malformed) return fail("invalid", ["Assessment legacy claim receipt is invalid"])
    const sources = this.sources(); const sourceRaw = source === "v26" ? sources.session ?? sources.respondents : sources.engagement
    if (sourceRaw === null) return fail("invalid", ["No selected legacy Assessment data is available"])
    const oversizedSource = [sources.session, sources.respondents, sources.engagement].some((raw) => raw !== null && new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES)
    const sourceDigests = { assessment_session_v26: sources.session !== null ? `sha256:${await sha256(sources.session)}` : null, assessment_respondents_v26: sources.respondents !== null ? `sha256:${await sha256(sources.respondents)}` : null, assessment_engagement_v1: sources.engagement !== null ? `sha256:${await sha256(sources.engagement)}` : null }
    if (existing.receipt && (existing.receipt.tenantId !== this.tenantId || existing.receipt.source !== source || JSON.stringify(existing.receipt.sourceDigests) !== JSON.stringify(sourceDigests))) return fail("conflict", ["Legacy Assessment data is already claimed"])
    const now = new Date().toISOString(); const claimId = existing.receipt?.claimId ?? `eng_${crypto.randomUUID()}`
    const receipt: LegacyClaimReceipt = existing.receipt ?? { schemaVersion: 1, claimId, tenantId: this.tenantId, source, sourceDigests, status: "pending", targetDocumentDigest: null, createdAt: now, updatedAt: now }
    const targetKey = this.receiptKeyTarget(claimId)
    const activeBefore = this.read(this.activeKey)
    if (receipt.targetDocumentDigest === null && activeBefore !== null) return fail("conflict", ["An active Assessment already exists"])
    if (existing.receipt?.targetDocumentDigest) {
      const resumedSources = this.sources()
      const resumedDigests = {
        assessment_session_v26: resumedSources.session !== null ? `sha256:${await sha256(resumedSources.session)}` : null,
        assessment_respondents_v26: resumedSources.respondents !== null ? `sha256:${await sha256(resumedSources.respondents)}` : null,
        assessment_engagement_v1: resumedSources.engagement !== null ? `sha256:${await sha256(resumedSources.engagement)}` : null,
      }
      if (!equalJson(resumedDigests, existing.receipt.sourceDigests)) return fail("conflict", ["Legacy Assessment data changed during recovery"])
      const pinned = this.read(targetKey)
      if (pinned === null || `sha256:${await sha256(pinned)}` !== existing.receipt.targetDocumentDigest) return fail("invalid", ["Legacy recovery target is missing or changed"])
      const active = this.read(this.activeKey)
      if (active !== null && active !== pinned) return fail("conflict", ["The active Assessment differs from its pinned recovery target"])
      const targetResult = validateSerializedDocument(pinned, this.tenantId)
      if (!targetResult.ok || !targetResult.document.legacyClaim || targetResult.document.legacyClaim.claimId !== claimId || targetResult.document.legacyClaim.source !== existing.receipt.source || !equalJson(targetResult.document.legacyClaim.sourceDigests, existing.receipt.sourceDigests)) return fail("invalid", ["Legacy recovery target is invalid"])
      if (active === null) { const copied = await this.replace(pinned, targetResult.document, true); if (!copied.ok) return copied }
      if (existing.receipt.status === "pending") {
        const complete = { ...existing.receipt, status: "complete" as const, updatedAt: new Date().toISOString() }
        if (!this.writeReceiptVerified(complete, existing.raw)) return fail("storage_failure", safeError())
      }
      const final = await this.loadNow()
      return final.status === "ready" ? { ok: true, document: final.document } : fail("storage_failure", safeError())
    }
    // Publish the verified pending receipt before parsing or converting the
    // selected legacy bytes. This pins even malformed content to its owner.
    if (!this.writeReceiptVerified(receipt, existing.raw)) return fail("storage_failure", safeError())
    if (oversizedSource) return fail("invalid", ["legacy source exceeds 1 MiB"])
    let document: EngagementDocument
    let targetRaw: string
    const targetExisting = this.read(targetKey)
    if (targetExisting !== null) {
      const existingTarget = validateSerializedDocument(targetExisting, this.tenantId)
      if (!existingTarget.ok || !existingTarget.document.legacyClaim || existingTarget.document.legacyClaim.claimId !== claimId || existingTarget.document.legacyClaim.source !== source || !equalJson(existingTarget.document.legacyClaim.sourceDigests, sourceDigests)) return fail("conflict", ["Legacy recovery target conflicts with its receipt"])
      targetRaw = targetExisting; document = existingTarget.document
    } else {
      try { document = source === "v26" ? this.convertV26(sources.session, sources.respondents, claimId, sourceDigests) : this.convertV1(sources.engagement!, claimId, sourceDigests) } catch { return fail("invalid", ["Legacy Assessment data cannot be converted safely"]) }
      targetRaw = JSON.stringify(document)
    }
    if (new TextEncoder().encode(targetRaw).byteLength > MAX_SERIALIZED_BYTES) return fail("invalid", ["document exceeds 1 MiB"])
    try {
      if (targetExisting === null) this.storage.setItem(targetKey, targetRaw)
      const targetReadback = this.read(targetKey)
      const targetValidation = targetReadback === null ? null : validateSerializedDocument(targetReadback, this.tenantId)
      if (targetReadback !== targetRaw || !targetValidation?.ok || !targetValidation.document.legacyClaim || targetValidation.document.legacyClaim.claimId !== claimId || targetValidation.document.legacyClaim.source !== source || !equalJson(targetValidation.document.legacyClaim.sourceDigests, sourceDigests) || `sha256:${await sha256(targetReadback)}` !== `sha256:${await sha256(targetRaw)}`) return fail("storage_failure", safeError())
    } catch { return fail("storage_failure", safeError()) }
    const latestSources = this.sources()
    const latestDigests = { assessment_session_v26: latestSources.session !== null ? `sha256:${await sha256(latestSources.session)}` : null, assessment_respondents_v26: latestSources.respondents !== null ? `sha256:${await sha256(latestSources.respondents)}` : null, assessment_engagement_v1: latestSources.engagement !== null ? `sha256:${await sha256(latestSources.engagement)}` : null }
    if (!equalJson(latestDigests, sourceDigests)) return fail("conflict", ["Legacy Assessment data changed during recovery"])
    const pinnedReceipt = { ...receipt, targetDocumentDigest: `sha256:${await sha256(targetRaw)}`, updatedAt: new Date().toISOString() }
    if (!this.writeReceiptVerified(pinnedReceipt, JSON.stringify(receipt))) return fail("storage_failure", safeError())
    const copied = await this.replace(targetRaw, document, true)
    if (!copied.ok) return copied
    const beforeCompleteSources = this.sources()
    const beforeCompleteDigests = {
      assessment_session_v26: beforeCompleteSources.session !== null ? `sha256:${await sha256(beforeCompleteSources.session)}` : null,
      assessment_respondents_v26: beforeCompleteSources.respondents !== null ? `sha256:${await sha256(beforeCompleteSources.respondents)}` : null,
      assessment_engagement_v1: beforeCompleteSources.engagement !== null ? `sha256:${await sha256(beforeCompleteSources.engagement)}` : null,
    }
    if (!equalJson(beforeCompleteDigests, sourceDigests)) return fail("conflict", ["Legacy Assessment data changed during recovery"])
    const complete = { ...pinnedReceipt, status: "complete" as const, updatedAt: new Date().toISOString() }
    if (!this.writeReceiptVerified(complete, JSON.stringify(pinnedReceipt))) return fail("storage_failure", safeError())
    const finalReceipt = await this.receipt()
    const finalActive = this.read(this.activeKey)
    const finalSources = this.sources()
    const finalDigests = {
      assessment_session_v26: finalSources.session !== null ? `sha256:${await sha256(finalSources.session)}` : null,
      assessment_respondents_v26: finalSources.respondents !== null ? `sha256:${await sha256(finalSources.respondents)}` : null,
      assessment_engagement_v1: finalSources.engagement !== null ? `sha256:${await sha256(finalSources.engagement)}` : null,
    }
    if (finalReceipt.malformed) return fail("storage_failure", safeError())
    if (!finalReceipt.receipt || finalReceipt.receipt.status !== "complete" || finalReceipt.receipt.targetDocumentDigest !== `sha256:${await sha256(targetRaw)}` || finalActive !== targetRaw || !equalJson(finalDigests, sourceDigests)) return fail("conflict", ["Legacy Assessment data changed during recovery"])
    const final = await this.loadNow()
    return final.status === "ready" ? { ok: true, document: final.document } : fail("storage_failure", safeError())
  }
  private convertV26(sessionRaw: string | null, respondentsRaw: string | null, claimId: string, sourceDigests: LegacyClaim["sourceDigests"]): EngagementDocument {
    const session = sessionRaw === null ? {} : json(sessionRaw)
    if (!record(session)) throw new Error("session")
    if (sessionRaw !== null && !exact(session, ["clientInfo", "scores", "evidence", "currentPillar"])) throw new Error("session shape")
    const legacyClient = sessionRaw === null ? { name: "", department: "", operatingProfile: "", date: "", facilitator: "" } : session.clientInfo
    if (!record(legacyClient) || !exact(legacyClient, ["name", "department", "operatingProfile", "date", "facilitator"])) throw new Error("client shape")
    const clientInfo = legacyClient as unknown as AssessmentSession["clientInfo"]
    const candidateRespondents = respondentsRaw === null ? [] : json(respondentsRaw)
    if (!Array.isArray(candidateRespondents)) throw new Error("respondents")
    const respondents = candidateRespondents.map((entry) => {
      if (!record(entry)) throw new Error("respondent shape")
      const required = ["id", "name", "role", "timestamp", "scores", "evidence"]
      const allowed = ["id", "company", "department", "operatingProfile", "name", "role", "timestamp", "scores", "evidence"]
      if (Object.keys(entry).length < required.length || required.some((key) => !Object.prototype.hasOwnProperty.call(entry, key)) || Object.keys(entry).some((key) => !allowed.includes(key))) throw new Error("respondent shape")
      for (const key of ["company", "department", "operatingProfile"] as const) if (entry[key] !== undefined && typeof entry[key] !== "string") throw new Error("respondent context")
      return { id: entry.id, company: entry.company ?? "", department: entry.department ?? "", operatingProfile: entry.operatingProfile ?? "", name: entry.name, role: entry.role, timestamp: entry.timestamp, scores: entry.scores, evidence: entry.evidence }
    }) as unknown as Respondent[]
    const sessionValue: AssessmentSession = { clientInfo, scores: sessionRaw === null ? {} : session.scores as Record<string, number>, evidence: sessionRaw === null ? {} : session.evidence as Record<string, string>, currentPillar: sessionRaw === null ? 0 : session.currentPillar as number }
    const now = new Date().toISOString()
    const candidate = { schemaVersion: ENGAGEMENT_SCHEMA_VERSION, appVersion: ASSESSMENT_VERSION, tenantId: this.tenantId, engagementId: `eng_${crypto.randomUUID()}`, brandLabel: this.brandLabel, session: sessionValue as EngagementDocument["session"], respondents: respondents as EngagementDocument["respondents"], legacyClaim: { claimId, source: "v26" as const, sourceDigests }, readout: null, createdAt: now, updatedAt: now }
    const validation = validateEngagementDocument(candidate, this.tenantId)
    if (!validation.ok) throw new Error("v26 target invalid")
    return validation.document
  }
  private convertV1(raw: string, claimId: string, sourceDigests: LegacyClaim["sourceDigests"]): EngagementDocument {
    const input = json(raw)
    const requiredKeys = ["schemaVersion", "appVersion", "engagementId", "client", "brandLabel", "respondents", "scores", "generatedReadout", "createdAt", "updatedAt"] as const
    const allowedKeys = [...requiredKeys, "sessionState"]
    if (!record(input) || requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(input, key)) || Object.keys(input).some((key) => !allowedKeys.includes(key))) throw new Error("document shape")
    if (input.schemaVersion !== 1) throw new Error("schemaVersion")
    if (typeof input.appVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(input.appVersion)) throw new Error("appVersion")
    if (typeof input.engagementId !== "string" || input.engagementId.length === 0) throw new Error("engagementId")
    const client = input.client; if (!record(client) || typeof client.name !== "string") throw new Error("client")
    for (const key of ["department", "operatingProfile", "date", "facilitator"] as const) if (client[key] !== undefined && typeof client[key] !== "string") throw new Error("client field")
    if (input.brandLabel !== null && typeof input.brandLabel !== "string") throw new Error("brandLabel")
    if (!canonicalIso(input.createdAt) || !canonicalIso(input.updatedAt)) throw new Error("timestamp")
    if (input.generatedReadout !== null && typeof input.generatedReadout !== "string") throw new Error("generatedReadout")
    const stateRaw = input.sessionState
    let state: Record<string, unknown> = { currentPillar: 0 }
    if (stateRaw !== undefined && stateRaw !== null) {
      if (!record(stateRaw)) throw new Error("sessionState shape")
      if (exact(stateRaw, ["currentPillar"])) state = stateRaw
      else if (exact(stateRaw, ["clientInfo", "scores", "evidence", "currentPillar"])) {
        if (!record(stateRaw.scores) || !record(stateRaw.evidence)) throw new Error("sessionState maps")
        state = stateRaw
      }
      else throw new Error("sessionState shape")
    }
    const topClient = { name: client.name, department: typeof client.department === "string" ? client.department : "", operatingProfile: typeof client.operatingProfile === "string" ? client.operatingProfile : "", date: typeof client.date === "string" ? client.date : "", facilitator: typeof client.facilitator === "string" ? client.facilitator : "" }
    let clientInfo = topClient
    if (state.clientInfo !== undefined) {
      if (!record(state.clientInfo) || !exact(state.clientInfo, ["name", "department", "operatingProfile", "date", "facilitator"])) throw new Error("session client shape")
      const full = state.clientInfo
      clientInfo = { name: typeof full.name === "string" && full.name !== "" ? full.name : topClient.name, department: typeof full.department === "string" && full.department !== "" ? full.department : topClient.department, operatingProfile: typeof full.operatingProfile === "string" && full.operatingProfile !== "" ? full.operatingProfile : topClient.operatingProfile, date: typeof full.date === "string" && full.date !== "" ? full.date : topClient.date, facilitator: typeof full.facilitator === "string" && full.facilitator !== "" ? full.facilitator : topClient.facilitator }
      for (const key of ["name", "department", "operatingProfile", "date", "facilitator"] as const) if (typeof full[key] !== "string") throw new Error("session client field")
      for (const key of ["name", "department", "operatingProfile", "date", "facilitator"] as const) if (full[key] !== "" && topClient[key] !== "" && full[key] !== topClient[key]) throw new Error("client conflict")
    }
    const respondentValues = input.respondents
    if (!Array.isArray(respondentValues)) throw new Error("respondents")
    const index = input.scores
    if (!record(index)) throw new Error("score index")
    const respondentIds = new Set<string>()
    const respondents = respondentValues.map((entry) => {
      if (!record(entry)) throw new Error("respondent")
      if (typeof entry.id !== "string" || respondentIds.has(entry.id)) throw new Error("respondent id")
      respondentIds.add(entry.id)
      for (const key of ["name", "role", "timestamp"] as const) if (typeof entry[key] !== "string") throw new Error("respondent field")
      for (const key of ["company", "department", "operatingProfile"] as const) if (entry[key] !== undefined && typeof entry[key] !== "string") throw new Error("respondent context")
      if (entry.evidence !== undefined && !record(entry.evidence)) throw new Error("respondent evidence")
      const indexed = index[entry.id]
      if (indexed === undefined || !record(indexed)) throw new Error("missing respondent score index")
      const embedded = entry.scores === undefined ? {} : entry.scores
      if (!record(embedded)) throw new Error("respondent scores")
      if (Object.keys(embedded).length > 0 && !equalJson(embedded, indexed)) throw new Error("respondent score conflict")
      return { id: entry.id, company: typeof entry.company === "string" ? entry.company : "", department: typeof entry.department === "string" ? entry.department : "", operatingProfile: typeof entry.operatingProfile === "string" ? entry.operatingProfile : "", name: entry.name, role: entry.role, timestamp: entry.timestamp, scores: (Object.keys(embedded).length > 0 ? embedded : indexed) as Record<string, number>, evidence: (entry.evidence ?? {}) as Record<string, string> }
    })
    for (const key of Object.keys(index)) if (!respondentIds.has(key)) throw new Error("score index mismatch")
    const engagementId = input.engagementId as string
    const generatedReadout = typeof input.generatedReadout === "string" && input.generatedReadout ? { text: input.generatedReadout, generatedAt: null, inputDigest: null } : null
    const candidate = { schemaVersion: 2, appVersion: input.appVersion as string, tenantId: this.tenantId, engagementId, brandLabel: input.brandLabel as string | null, session: { clientInfo, scores: (state.scores ?? {}) as Record<string, number>, evidence: (state.evidence ?? {}) as Record<string, string>, currentPillar: state.currentPillar as number }, respondents, legacyClaim: { claimId, source: "engagement_v1" as const, sourceDigests }, readout: generatedReadout, createdAt: input.createdAt as string, updatedAt: input.updatedAt as string }
    const validation = validateEngagementDocument(candidate, this.tenantId)
    if (!validation.ok) throw new Error("v1 target invalid")
    return validation.document
  }
}
