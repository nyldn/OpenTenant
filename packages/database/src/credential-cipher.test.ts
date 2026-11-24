import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { CredentialCipher } from "./credential-cipher";

const TEST_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const CONNECTION_STRING = "postgresql://tenant:secret@db.example.test/tenant";
const AAD = "tenant_a";

describe("CredentialCipher", () => {
  it("encrypts and decrypts a credential", () => {
    const cipher = new CredentialCipher(TEST_KEY);

    const encrypted = cipher.encrypt(CONNECTION_STRING, AAD);

    expect(encrypted).not.toBe(CONNECTION_STRING);
    expect(cipher.decrypt(encrypted, AAD)).toBe(CONNECTION_STRING);
  });

  it("uses a random IV for each encryption", () => {
    const cipher = new CredentialCipher(TEST_KEY);

    expect(cipher.encrypt(CONNECTION_STRING, AAD)).not.toBe(
      cipher.encrypt(CONNECTION_STRING, AAD),
    );
  });

  it("rejects tampered ciphertext without exposing plaintext", () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const parts = cipher.encrypt(CONNECTION_STRING, AAD).split(".");
    const raw = Buffer.from(parts[4]!, "base64url");
    raw[0] = (raw[0] ?? 0) ^ 1;
    parts[4] = raw.toString("base64url");

    let thrown: unknown;
    try {
      cipher.decrypt(parts.join("."), AAD);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (!(thrown instanceof Error))
      throw new Error("expected decryption to throw");
    expect(thrown.message).toContain("failed authentication");
    expect(thrown.message).not.toContain(CONNECTION_STRING);
  });

  it("rejects decryption with different additional authenticated data", () => {
    const cipher = new CredentialCipher(TEST_KEY);
    const encrypted = cipher.encrypt(CONNECTION_STRING, AAD);

    expect(() => cipher.decrypt(encrypted, "tenant_b")).toThrow(
      "encrypted credential record failed authentication",
    );
  });

  it.each([31, 33])("rejects a key that decodes to %i bytes", (length) => {
    const invalidKey = Buffer.alloc(length, 7).toString("base64");

    expect(() => new CredentialCipher(invalidKey)).toThrow("exactly 32 bytes");
  });

  it("throws when the encryption key environment variable is missing", () => {
    expect(() => CredentialCipher.fromEnv({})).toThrow(
      "Missing TENANT_DB_ENCRYPTION_KEY",
    );
  });
});

describe("versioned keyring", () => {
  const k1 = Buffer.alloc(32, 1).toString("base64");
  const ring = () =>
    CredentialCipher.fromEnv({
      TENANT_DB_ENCRYPTION_KEY: TEST_KEY,
      TENANT_DB_ENCRYPTION_KEYS: `k1:${k1}`,
      TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: "k1",
    });

  it("reads legacy ciphertext and writes a version and active key id", async () => {
    const { createCipheriv } = await import("node:crypto");
    const iv = Buffer.alloc(12, 3);
    const legacy = createCipheriv(
      "aes-256-gcm",
      Buffer.from(TEST_KEY, "base64"),
      iv,
    );
    legacy.setAAD(Buffer.from(AAD));
    const ct = Buffer.concat([
      legacy.update(CONNECTION_STRING),
      legacy.final(),
    ]);
    const encoded = Buffer.concat([iv, ct, legacy.getAuthTag()]).toString(
      "base64",
    );
    expect(ring().decrypt(encoded, AAD)).toBe(CONNECTION_STRING);
    expect(ring().needsRotation(encoded)).toBe(true);
    const current = ring().encrypt(CONNECTION_STRING, AAD);
    expect(current).toMatch(/^v1\.aesgcm256\.k1\./);
    expect(ring().needsRotation(current)).toBe(false);
  });

  it("reads a mixed keyring and rejects unknown keys and wrong AAD", () => {
    const old = new CredentialCipher(TEST_KEY).encrypt(CONNECTION_STRING, AAD);
    expect(ring().decrypt(old, AAD)).toBe(CONNECTION_STRING);
    expect(() => ring().decrypt(old, "tenant_b")).toThrow(
      "failed authentication",
    );
    expect(() =>
      ring().decrypt(old.replace(".k0.", ".missing."), AAD),
    ).toThrow();
    expect(() =>
      ring().decrypt(
        ring().encrypt(CONNECTION_STRING, AAD).replace(".k1.", ".k0."),
        AAD,
      ),
    ).toThrow();
  });

  it.each([
    { TENANT_DB_ENCRYPTION_KEYS: `k1:${k1}` },
    {
      TENANT_DB_ENCRYPTION_KEYS: `k1:${k1},k1:${k1}`,
      TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: "k1",
    },
    {
      TENANT_DB_ENCRYPTION_KEYS: `bad.id:${k1}`,
      TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: "bad.id",
    },
    {
      TENANT_DB_ENCRYPTION_KEYS: "k1:invalid",
      TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: "k1",
    },
    {
      TENANT_DB_ENCRYPTION_KEY: TEST_KEY,
      TENANT_DB_ENCRYPTION_KEYS: `k0:${k1}`,
      TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: "k0",
    },
  ])("fails closed on an ambiguous or invalid keyring", (env) => {
    expect(() => CredentialCipher.fromEnv(env)).toThrow();
  });
});

it("authenticates the envelope header even when key aliases share material", () => {
  const key = Buffer.alloc(32, 3).toString("base64");
  const cipher = new CredentialCipher({ k0: key, k1: key }, "k1");
  const encoded = cipher.encrypt("synthetic-secret", AAD);
  expect(() => cipher.decrypt(encoded.replace(".k1.", ".k0."), AAD)).toThrow(
    "failed authentication",
  );
});
