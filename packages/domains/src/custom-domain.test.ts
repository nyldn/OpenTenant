import { describe, expect, it } from "vitest";
import { customDomainHost } from "./custom-domain";
import { evaluateDomainVerification, hashChallenge } from "./verification";

describe("custom domain policy", () => {
  it("normalizes DNS names", () => expect(customDomainHost(" APP.Customer.test. ", ["platform.test"])).toBe("app.customer.test"));
  it.each(["customer.test", "co.uk", "customer.co.uk", "127.0.0.1", "[::1]", "platform.test", "alpha.platform.test", "app.xn--pple-43d.test", "аpp.customer.test", "app.customer.test:443", "app.customer.test/path", "www.github.io"])("rejects %s", (host) => {
    expect(customDomainHost(host, ["platform.test"])).toBeNull();
  });
  it("respects multi-label and private suffixes", () => {
    expect(customDomainHost("app.customer.co.uk", [])).toBe("app.customer.co.uk");
    expect(customDomainHost("app.customer.github.io", [])).toBe("app.customer.github.io");
  });
});

describe("pure DNS verification decision", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const challenge = { hash: hashChallenge("opentenant-" + "a".repeat(64)), expiresAt: new Date("2026-11-12"), previouslyVerified: false };
  it("accepts split TXT chunks, schedules rechecks, and has no side effects", () => {
    const result = evaluateDomainVerification(challenge, [["opentenant-", "a".repeat(64)]], now);
    expect(result.verification).toBe("verified");
    expect(result.active).toBe(true);
    expect(result.nextCheckAt.getTime() - now.getTime()).toBe(86400000);
    expect(result.validUntil!.getTime() - now.getTime()).toBe(172800000);
  });
  it.each([{ records: [] }, { records: [["wrong"]] }, { records: [["opentenant-" + "b".repeat(64)]] }])("fails closed without the matching TXT", ({ records }) => {
    expect(evaluateDomainVerification(challenge, records, now)).toMatchObject({ active: false, verification: "failed", validUntil: null });
  });
  it("expires an initial challenge", () => {
    expect(evaluateDomainVerification({ ...challenge, expiresAt: now }, [["opentenant-" + "a".repeat(64)]], now).active).toBe(false);
  });
  it("can reverify the retained hash after initial challenge expiry", () => {
    expect(evaluateDomainVerification({ ...challenge, expiresAt: now, previouslyVerified: true }, [["opentenant-" + "a".repeat(64)]], now).active).toBe(true);
  });
});
