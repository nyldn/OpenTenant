import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "@opentenant/security/canonical-json";
import type { AuditEvent, AuditChainVerification, AuditChainFailure } from "./index";

// New events use canonical JSON and bind the tenant scope. Verification also
// accepts the exact former JSON.stringify format, but cannot reconstruct a
// legacy hash after jsonb has already changed its key order.
export function auditEventHash(previousHash: string, e: Omit<AuditEvent, "hash" | "previousHash">): string {
  const input = canonicalJsonStringify({
    previousHash,
    sequence: e.sequence,
    tenantId: e.tenantId,
    occurredAt: e.occurredAt.toISOString(),
    actor: e.actor,
    action: e.action,
    subject: e.subject,
    detail: e.detail,
  });
  if (input === undefined) throw new TypeError("Audit hash input could not be serialized");
  return createHash("sha256").update(input).digest("hex");
}

function legacyEventHash(
  previousHash: string,
  e: Omit<AuditEvent, "hash" | "previousHash">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        previousHash,
        sequence: e.sequence,
        occurredAt: e.occurredAt.toISOString(),
        actor: e.actor,
        action: e.action,
        subject: e.subject,
        detail: e.detail,
      }),
    )
    .digest("hex");
}

export function verifyAuditEvents(events: readonly AuditEvent[]): AuditChainVerification {
  let previousHash = "genesis";
  let expectedSequence = 1;
  let legacySeen = false;
  let canonicalFromSequence: number | null = null;
  const failed = (
    brokenAtSequence: number,
    failure: Exclude<AuditChainFailure, null>,
  ): AuditChainVerification => ({
    intact: false,
    brokenAtSequence,
    assurance: "unverified",
    canonicalFromSequence,
    failure,
  });
  for (const e of events) {
    if (!Number.isSafeInteger(e.sequence) || e.sequence !== expectedSequence) return failed(e.sequence, "sequence_gap");
    if (e.previousHash !== previousHash) return failed(e.sequence, "previous_hash_mismatch");

    const canonical = auditEventHash(previousHash, e) === e.hash;
    const legacy = !canonical && legacyEventHash(previousHash, e) === e.hash;
    if (!canonical && !legacy) return failed(e.sequence, "hash_mismatch");
    if (legacy && canonicalFromSequence !== null) {
      return failed(e.sequence, "format_downgrade");
    }
    if (legacy) legacySeen = true;
    if (canonical && canonicalFromSequence === null) canonicalFromSequence = e.sequence;
    previousHash = e.hash;
    expectedSequence += 1;
  }
  return {
    intact: true,
    brokenAtSequence: null,
    assurance: events.length === 0 ? "empty" : legacySeen ? "legacy-unbound" : "canonical",
    canonicalFromSequence,
    failure: null,
  };
}
