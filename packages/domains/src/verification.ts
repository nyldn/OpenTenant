import { createHash, timingSafeEqual } from "node:crypto";

export function hashChallenge(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface DomainChallenge {
  hash: string;
  expiresAt: Date;
  previouslyVerified: boolean;
}

/** Pure decision: the caller supplies DNS observations and time; no I/O. */
export function evaluateDomainVerification(challenge: DomainChallenge, txtRecords: readonly (readonly string[])[], now: Date) {
  const validHash = /^[a-f0-9]{64}$/.test(challenge.hash);
  const matched = validHash && txtRecords.slice(0, 100).some((chunks) => {
    const value = chunks.join("");
    return value.length <= 256 && timingSafeEqual(Buffer.from(hashChallenge(value), "hex"), Buffer.from(challenge.hash, "hex"));
  });
  const active = matched && (challenge.previouslyVerified || challenge.expiresAt.getTime() > now.getTime());
  return {
    verification: active ? "verified" as const : "failed" as const,
    active,
    validUntil: active ? new Date(now.getTime() + 2 * 86400000) : null,
    nextCheckAt: new Date(now.getTime() + 86400000),
  };
}

export type DomainRecheckReason = "dns_unverified" | "dns_unavailable";

/** Keep the original validity deadline as the grace limit. Failed DNS never extends it. */
export function evaluateDomainRecheck(
  input: { host: string; challenge: DomainChallenge; validUntil: Date },
  records: readonly (readonly string[])[],
  now: Date,
  failure: DomainRecheckReason = "dns_unverified",
) {
  const result = evaluateDomainVerification(input.challenge, records, now);
  // Stable host offsets spread successful checks across an hour, still well before expiry.
  const offset = Number.parseInt(hashChallenge(input.host).slice(0, 8), 16) % 3_600_000;
  if (result.active) return { ...result, nextCheckAt: new Date(result.nextCheckAt.getTime() + offset), reason: null };
  const active = input.validUntil.getTime() > now.getTime();
  return {
    verification: active ? "verified" as const : "failed" as const,
    active,
    validUntil: input.validUntil,
    nextCheckAt: new Date(Math.min(now.getTime() + 3_600_000, active ? input.validUntil.getTime() : Infinity)),
    reason: failure,
  };
}
