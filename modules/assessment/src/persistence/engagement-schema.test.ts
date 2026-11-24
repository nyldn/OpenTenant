import { describe, expect, it } from "vitest"
import { engagementFromSession, MAX_SERIALIZED_BYTES, validateEngagementDocument, validateLegacyClaimReceipt, validateSerializedDocument } from "./engagement-schema"
import { emptyAssessmentSession } from "../store"

const at = "2026-09-06T00:00:00.000Z"
function valid() { return engagementFromSession({ tenantId: "tenant-a", appVersion: "v1.0.0", session: emptyAssessmentSession, respondents: [], engagementId: "eng_1", createdAt: at, updatedAt: at }) }

describe("Assessment engagement schema v2", () => {
  it("canonicalizes a valid document without returning the input object", () => { const input = valid(); const result = validateEngagementDocument(input, "tenant-a"); expect(result.ok).toBe(true); if (result.ok) expect(result.document).not.toBe(input) })
  it.each(["tenant-b", "", "eng_1"]) ("rejects an untrusted or empty tenant (%s)", (tenantId) => { const result = validateEngagementDocument({ ...valid(), tenantId }, "tenant-a"); expect(result.ok).toBe(false) })
  it("rejects extra keys, unknown dimensions, non-finite scores, duplicate IDs, and invalid dates", () => { const input = valid() as unknown as Record<string, unknown>; expect(validateEngagementDocument({ ...input, extra: true }).ok).toBe(false); const session = input.session as Record<string, unknown>; expect(validateEngagementDocument({ ...input, session: { ...session, scores: { unknown: 3 } } }).ok).toBe(false); expect(validateEngagementDocument({ ...input, session: { ...session, scores: { "strategy__ai_vision": Number.NaN } } }).ok).toBe(false); expect(validateEngagementDocument({ ...input, session: { ...session, clientInfo: { ...(session.clientInfo as object), date: "2026-02-30" } } }).ok).toBe(false) })
  it("rejects malformed readout bindings and preserves valid empty evidence", () => { const input = valid(); input.session.evidence["strategy__ai_vision"] = ""; expect(validateEngagementDocument(input, "tenant-a").ok).toBe(true); expect(validateEngagementDocument({ ...input, readout: { text: "saved", generatedAt: at, inputDigest: null } }, "tenant-a").ok).toBe(false) })
  it("enforces the serialized byte limit before parsing", () => { const raw = "x".repeat(MAX_SERIALIZED_BYTES + 1); expect(validateSerializedDocument(raw).ok).toBe(false) })
  it("bounds invalid output while keeping unknown map keys content-free", () => {
    const input = valid(); input.respondents = Array.from({ length: 500 }, (_, index) => ({ id: `r-${index}`, company: 7 as never, department: 8 as never, operatingProfile: "", name: "", role: 9 as never, timestamp: "bad", scores: { [`unknown-${index}`]: 7 }, evidence: {} }))
    const result = validateEngagementDocument(input, "tenant-a")
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.errors.length).toBeLessThanOrEqual(64); expect(JSON.stringify(result.errors).length).toBeLessThanOrEqual(8192); expect(result.errors.join(" ")).not.toContain("unknown-499") }
  })
  it("does not echo hostile unsupported map keys or values", () => {
    const hostileKey = "unknown-" + "x".repeat(10000)
    const input = valid(); input.session.scores = { [hostileKey]: "secret-value" as never }
    const result = validateEngagementDocument(input, "tenant-a")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(" ")).not.toContain(hostileKey)
      expect(result.errors.join(" ")).not.toContain("secret-value")
      expect(result.errors.join(" ").length).toBeLessThan(8192)
    }
  })
  it("requires non-empty receipt IDs but does not couple them to engagement IDs", () => { const receipt = { schemaVersion: 1, claimId: "claim-1", tenantId: "tenant-a", source: "engagement_v1", sourceDigests: { assessment_session_v26: null, assessment_respondents_v26: null, assessment_engagement_v1: "sha256:" + "a".repeat(64) }, status: "pending", targetDocumentDigest: null, createdAt: at, updatedAt: at }; expect(validateLegacyClaimReceipt(receipt, "tenant-a").ok).toBe(true); expect(validateLegacyClaimReceipt({ ...receipt, claimId: "" }, "tenant-a").ok).toBe(false) })
})
