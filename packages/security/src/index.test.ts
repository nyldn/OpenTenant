import { describe, expect, it } from "vitest";
import {
  hashPasscode,
  signModuleAccess,
  verifyModuleAccess,
  verifyPasscode,
} from "./index";

const SECRET = "test-module-access-secret";
const TENANT_ID = "tenant_test";
const MODULE_KEY = "assessment";
const NOW = 1_750_000_000_000;
const EXPIRES_AT = NOW + 60_000;

const grant = {
  tenantId: TENANT_ID,
  moduleKey: MODULE_KEY,
  policyBinding: "policy-one",
  expiresAt: EXPIRES_AT,
};

const expected = {
  tenantId: TENANT_ID,
  moduleKey: MODULE_KEY,
  policyBinding: "policy-one",
};

function splitToken(token: string): { payload: string; mac: string } {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    throw new Error("expected a signed module-access token");
  }

  return {
    payload: token.slice(0, dot),
    mac: token.slice(dot + 1),
  };
}

describe("module access tokens", () => {
  it("round trips a valid signed grant", () => {
    const token = signModuleAccess(grant, SECRET);

    expect(verifyModuleAccess(token, expected, SECRET, NOW)).toBe(true);
  });

  it("rejects an expired grant", () => {
    const token = signModuleAccess(grant, SECRET);

    expect(verifyModuleAccess(token, expected, SECRET, EXPIRES_AT + 1)).toBe(false);
  });

  it("rejects the wrong tenantId or moduleKey", () => {
    const token = signModuleAccess(grant, SECRET);

    expect(
      verifyModuleAccess(token, { ...expected, tenantId: "tenant_other" }, SECRET, NOW),
    ).toBe(false);
    expect(
      verifyModuleAccess(token, { ...expected, moduleKey: "other" }, SECRET, NOW),
    ).toBe(false);
  });

  it("rejects a grant issued under a rotated passcode policy", () => {
    const token = signModuleAccess(grant, SECRET);

    expect(verifyModuleAccess(token, { ...expected, policyBinding: "policy-two" }, SECRET, NOW)).toBe(false);
    expect(verifyModuleAccess(token, { ...expected, policyBinding: "" }, SECRET, NOW)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const { payload, mac } = splitToken(signModuleAccess(grant, SECRET));
    const tamperedToken = `A${payload}.${mac}`;

    expect(verifyModuleAccess(tamperedToken, expected, SECRET, NOW)).toBe(false);
  });

  it("rejects a tampered mac", () => {
    const { payload, mac } = splitToken(signModuleAccess(grant, SECRET));
    const firstCharacter = mac.startsWith("A") ? "B" : "A";
    const tamperedToken = `${payload}.${firstCharacter}${mac.slice(1)}`;

    expect(verifyModuleAccess(tamperedToken, expected, SECRET, NOW)).toBe(false);
  });

  it("rejects a token without a dot", () => {
    expect(verifyModuleAccess("not-a-signed-token", expected, SECRET, NOW)).toBe(false);
  });
});

describe("passcode hashing", () => {
  const base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  function makeTrailingBitsNonCanonical(encoded: string): string {
    const last = encoded.at(-1)!;
    return `${encoded.slice(0, -1)}${base64urlAlphabet[base64urlAlphabet.indexOf(last) + 1]}`;
  }

  it("round trips a passcode", () => {
    const stored = hashPasscode("correct horse battery staple");

    expect(verifyPasscode("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects the wrong passcode", () => {
    const stored = hashPasscode("correct passcode");

    expect(verifyPasscode("wrong passcode", stored)).toBe(false);
  });

  it("uses random salts while keeping both hashes verifiable", () => {
    const first = hashPasscode("same passcode");
    const second = hashPasscode("same passcode");

    expect(first).not.toBe(second);
    expect(verifyPasscode("same passcode", first)).toBe(true);
    expect(verifyPasscode("same passcode", second)).toBe(true);
  });

  it("rejects a malformed stored string", () => {
    expect(verifyPasscode("passcode", "not-a-scrypt-hash")).toBe(false);
  });

  it.each([
    "scrypt$NaN$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "scrypt$016384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "scrypt$16384$8$1$*$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "scrypt$16384$8$1$AAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA",
  ])("rejects hostile canonical-looking stored data without throwing: %s", (stored) => {
    expect(() => verifyPasscode("passcode", stored)).not.toThrow();
    expect(verifyPasscode("passcode", stored)).toBe(false);
  });

  it.each([4, 5])("rejects a non-canonical base64url field at index %i", (fieldIndex) => {
    const parts = hashPasscode("passcode").split("$");
    parts[fieldIndex] = makeTrailingBitsNonCanonical(parts[fieldIndex]!);

    expect(verifyPasscode("passcode", parts.join("$"))).toBe(false);
  });
});
