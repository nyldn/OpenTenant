import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  essentialScopesGranted,
  generatePkcePair,
  signOAuthState,
  verifyOAuthState,
} from "./connections";

const SECRET = "test-secret-string";

describe("OAuth state", () => {
  it("round-trips valid claims", () => {
    const state = signOAuthState(
      { tenantId: "ten_a", userId: "user_1", provider: "google", expiresAt: Date.now() + 60_000 },
      SECRET,
    );
    expect(verifyOAuthState(state, SECRET)).toEqual({
      tenantId: "ten_a",
      userId: "user_1",
      provider: "google",
    });
  });

  it("rejects expiry, tamper, wrong key, and unknown providers", () => {
    const expired = signOAuthState(
      { tenantId: "ten_a", userId: "user_1", provider: "slack", expiresAt: Date.now() - 1 },
      SECRET,
    );
    expect(verifyOAuthState(expired, SECRET)).toBeNull();

    const state = signOAuthState(
      { tenantId: "ten_a", userId: "user_1", provider: "slack", expiresAt: Date.now() + 60_000 },
      SECRET,
    );
    expect(verifyOAuthState(state, "other-secret")).toBeNull();
    expect(verifyOAuthState(`x${state}`, SECRET)).toBeNull();
    expect(verifyOAuthState("malformed", SECRET)).toBeNull();

    const forgedPayload = Buffer.from(
      JSON.stringify({ tenantId: "ten_b", userId: "user_1", provider: "google", expiresAt: Date.now() + 60_000 }),
    ).toString("base64url");
    expect(verifyOAuthState(`${forgedPayload}.${state.split(".")[1]}`, SECRET)).toBeNull();
  });

  it("carries the encrypted PKCE verifier opaquely", () => {
    const state = signOAuthState(
      {
        tenantId: "ten_a",
        userId: "user_1",
        provider: "google",
        expiresAt: Date.now() + 60_000,
        encryptedVerifier: "ciphertext-blob",
      },
      SECRET,
    );
    expect(verifyOAuthState(state, SECRET)?.encryptedVerifier).toBe("ciphertext-blob");
  });
});

describe("PKCE", () => {
  it("produces an S256 challenge for the verifier", () => {
    const { verifier, challenge } = generatePkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("essentialScopesGranted", () => {
  it("requires every essential scope", () => {
    expect(
      essentialScopesGranted("google", [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
        "openid",
      ]),
    ).toBe(true);
    expect(
      essentialScopesGranted("google", ["https://www.googleapis.com/auth/gmail.readonly"]),
    ).toBe(false);
    expect(essentialScopesGranted("slack", ["channels:history", "channels:read", "users:read"])).toBe(true);
  });
});
