import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signModuleContext, verifyModuleContext } from "./module-context";

const NOW = 1_750_000_000_000;

const claims = {
  tenantId: "tenant_test",
  moduleKey: "assessment",
  moduleVersion: "1.2.3",
  userId: "user_test",
  permissions: ["read", "export"],
  brand: {
    displayName: "Test Tenant",
    logoUrl: null,
    cssBrandKey: "test-tenant",
  },
};

function generatePemKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function tamperPayload(token: string): string {
  const dot = token.indexOf(".");
  if (dot <= 0) throw new Error("expected a signed module-context token");

  const payload = token.slice(0, dot);
  const replacement = payload[0] === "A" ? "B" : "A";
  return `${replacement}${payload.slice(1)}${token.slice(dot)}`;
}

describe("module context tokens", () => {
  it("signs and verifies matching claims", () => {
    const keyPair = generatePemKeyPair();
    const token = signModuleContext(claims, keyPair.privateKeyPem, NOW);

    const result = verifyModuleContext(
      token,
      keyPair.publicKeyPem,
      { moduleKey: "assessment", moduleVersion: "1.2.3" },
      NOW,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(`expected a valid token, got ${result.reason}`);
    expect(result.claims).toMatchObject({
      tenantId: "tenant_test",
      moduleKey: "assessment",
      moduleVersion: "1.2.3",
      permissions: ["read", "export"],
    });
  });

  it("rejects a signature verified with a different module public key", () => {
    const signingKeyPair = generatePemKeyPair();
    const otherKeyPair = generatePemKeyPair();
    const token = signModuleContext(claims, signingKeyPair.privateKeyPem, NOW);

    expect(
      verifyModuleContext(token, otherKeyPair.publicKeyPem, { moduleKey: "assessment", moduleVersion: "1.2.3" }, NOW),
    ).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("rejects an expired token", () => {
    const keyPair = generatePemKeyPair();
    const token = signModuleContext(claims, keyPair.privateKeyPem, NOW);

    expect(
      verifyModuleContext(token, keyPair.publicKeyPem, { moduleKey: "assessment", moduleVersion: "1.2.3" }, NOW + 60 * 60 * 1000),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a tampered payload", () => {
    const keyPair = generatePemKeyPair();
    const token = tamperPayload(signModuleContext(claims, keyPair.privateKeyPem, NOW));
    const result = verifyModuleContext(token, keyPair.publicKeyPem, { moduleKey: "assessment", moduleVersion: "1.2.3" }, NOW);

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected a tampered token to be rejected");
    expect(["bad_signature", "malformed"]).toContain(result.reason);
  });

  it("rejects the wrong expected moduleKey", () => {
    const keyPair = generatePemKeyPair();
    const token = signModuleContext(claims, keyPair.privateKeyPem, NOW);

    expect(
      verifyModuleContext(token, keyPair.publicKeyPem, { moduleKey: "other", moduleVersion: "1.2.3" }, NOW),
    ).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("rejects a context minted for a different immutable module version", () => {
    const keyPair = generatePemKeyPair();
    const token = signModuleContext(claims, keyPair.privateKeyPem, NOW);

    expect(verifyModuleContext(
      token,
      keyPair.publicKeyPem,
      { moduleKey: "assessment", moduleVersion: "2.0.0" },
      NOW,
    )).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("verifies a structurally valid version-bound context when the caller delegates version matching", () => {
    const keyPair = generatePemKeyPair();
    const token = signModuleContext(claims, keyPair.privateKeyPem, NOW);

    const result = verifyModuleContext(token, keyPair.publicKeyPem, { moduleKey: "assessment" }, NOW);

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(`expected a valid token, got ${result.reason}`);
    expect(result.claims.moduleVersion).toBe("1.2.3");
  });

  it("rejects signed claims with malformed identity or permission shapes", () => {
    const keyPair = generatePemKeyPair();
    const malformedClaims = {
      ...claims,
      permissions: ["read", 42],
    } as unknown as Parameters<typeof signModuleContext>[0];
    const token = signModuleContext(malformedClaims, keyPair.privateKeyPem, NOW);

    expect(verifyModuleContext(
      token,
      keyPair.publicKeyPem,
      { moduleKey: "assessment" },
      NOW,
    )).toEqual({ valid: false, reason: "malformed" });
  });

  it("rejects a malformed token without a dot", () => {
    const keyPair = generatePemKeyPair();

    expect(
      verifyModuleContext("not-a-signed-token", keyPair.publicKeyPem, { moduleKey: "assessment", moduleVersion: "1.2.3" }, NOW),
    ).toEqual({ valid: false, reason: "malformed" });
  });
});
