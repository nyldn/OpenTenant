import { describe, expect, it } from "vitest";
import { evaluateDomainRecheck, hashChallenge } from "./verification";

describe("scheduled domain verification", () => {
  const now = new Date("2030-01-02T00:00:00Z");
  const token = "opentenant-example";
  const input = {
    host: "app.customer.test",
    challenge: { hash: hashChallenge(token), expiresAt: new Date("2030-01-01"), previouslyVerified: true },
    validUntil: new Date("2030-01-03"),
  };
  it("extends validity and staggers the next check before expiry", () => {
    const result = evaluateDomainRecheck(input, [[token]], now);
    expect(result.active).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.validUntil).toEqual(new Date("2030-01-04"));
    expect(result.nextCheckAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + 86_400_000);
    expect(result.nextCheckAt.getTime()).toBeLessThan(now.getTime() + 90_000_000);
    expect(result.nextCheckAt.getTime()).toBeLessThan(result.validUntil!.getTime());
    expect(evaluateDomainRecheck({ ...input, host: "other.customer.test" }, [[token]], now).nextCheckAt).not.toEqual(result.nextCheckAt);
  });
  it("retries within grace without extending the original deadline", () => {
    expect(evaluateDomainRecheck(input, [], now)).toMatchObject({
      active: true, verification: "verified", validUntil: input.validUntil,
      nextCheckAt: new Date(now.getTime() + 3_600_000), reason: "dns_unverified",
    });
    const justBeforeExpiry = new Date(input.validUntil.getTime() - 1);
    expect(evaluateDomainRecheck(input, [], justBeforeExpiry).nextCheckAt).toEqual(input.validUntil);
  });
  it.each(["dns_unverified", "dns_unavailable"] as const)("deactivates at the grace deadline with safe reason %s", reason => {
    expect(evaluateDomainRecheck(input, [], input.validUntil, reason)).toMatchObject({
      active: false, verification: "failed", validUntil: input.validUntil, reason,
    });
  });
  it("respects a rotated challenge even if the former TXT remains published", () => {
    const rotated = { ...input, challenge: { ...input.challenge, hash: hashChallenge("replacement") } };
    expect(evaluateDomainRecheck(rotated, [[token]], input.validUntil).active).toBe(false);
    expect(evaluateDomainRecheck(rotated, [["replacement"]], input.validUntil).active).toBe(true);
  });
});
