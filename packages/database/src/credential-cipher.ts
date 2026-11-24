import { configuredKeys } from "./credential-config";
/** Tenant-bound AES-256-GCM. v1 envelope inspired by @47ng/cloak; no vendored code. */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;
const FAILURE = "encrypted credential record failed authentication";

function decodeKey(value: string): Buffer {
  if (!BASE64_KEY.test(value) || Buffer.from(value, "base64").length !== 32) {
    throw new Error(
      "TENANT_DB_ENCRYPTION_KEY(S) must decode to exactly 32 bytes",
    );
  }
  return Buffer.from(value, "base64");
}

export class CredentialCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;
  readonly activeKeyId: string;

  constructor(
    key: string | Readonly<Record<string, string>>,
    activeKeyId = "k0",
  ) {
    this.activeKeyId = activeKeyId;
    const entries =
      typeof key === "string" ? [["k0", key] as const] : Object.entries(key);
    if (!entries.length || entries.some(([id]) => !KEY_ID.test(id)))
      throw new Error("Invalid encryption key IDs");
    this.keys = new Map(entries.map(([id, value]) => [id, decodeKey(value)]));
    if (!this.keys.has(activeKeyId))
      throw new Error("Missing active encryption key ID");
  }

  static fromEnv(
    env: Readonly<Record<string, string | undefined>>,
  ): CredentialCipher {
    const configured = configuredKeys(env);
    return new CredentialCipher(configured.keys, configured.activeKeyId);
  }

  /** Binds a resumable run to exact target material, without persisting the key. */
  get activeKeyFingerprint(): string {
    return createHash("sha256")
      .update(this.keys.get(this.activeKeyId)!)
      .digest("hex");
  }

  needsRotation(encoded: string): boolean {
    return !encoded.startsWith(`v1.aesgcm256.${this.activeKeyId}.`);
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const header = `v1.aesgcm256.${this.activeKeyId}`;
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.keys.get(this.activeKeyId)!,
      iv,
    );
    // Authenticate the routing metadata too. JSON provides an unambiguous boundary.
    cipher.setAAD(Buffer.from(JSON.stringify([header, aad])));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return `${header}.${iv.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  decrypt(encoded: string, aad: string): string {
    try {
      const { iv, payload, keyId, authenticatedData } = decodeEnvelope(
        encoded,
        aad,
      );
      const key = this.keys.get(keyId);
      if (!key || iv.length !== 12 || payload.length < 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(authenticatedData));
      decipher.setAuthTag(payload.subarray(-16));
      return Buffer.concat([
        decipher.update(payload.subarray(0, -16)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error(FAILURE);
    }
  }
}


function decodeEnvelope(encoded: string, aad: string) {
  let iv: Buffer;
  let payload: Buffer;
  let keyId = "k0";
  let authenticatedData = aad;
  if (encoded.includes(".")) {
    const parts = encoded.split(".");
    const [version, algorithm, id, nonce, ct] = parts;
    if (
      parts.length !== 5 ||
      version !== "v1" ||
      algorithm !== "aesgcm256" ||
      !id ||
      !KEY_ID.test(id) ||
      !nonce ||
      !ct ||
      !/^[A-Za-z0-9_-]+$/.test(nonce) ||
      !/^[A-Za-z0-9_-]+$/.test(ct)
    )
      throw new Error();
    keyId = id;
    iv = Buffer.from(nonce, "base64url");
    payload = Buffer.from(ct, "base64url");
    authenticatedData = JSON.stringify([`v1.aesgcm256.${id}`, aad]);
  } else {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error();
    const raw = Buffer.from(encoded, "base64");
    iv = raw.subarray(0, 12);
    payload = raw.subarray(12);
  }
  return { iv, payload, keyId, authenticatedData };
}
