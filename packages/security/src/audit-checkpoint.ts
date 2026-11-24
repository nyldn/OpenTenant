import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

export interface AuditCheckpoint {
  origin: string;
  sequence: number;
  /** Hex SHA-256 chain head. Empty chains use SHA-256("genesis"). */
  hash: string;
}
export type CheckpointPublicKeys = Readonly<Record<string, KeyObject>>;
export const EMPTY_AUDIT_HASH = createHash("sha256").update("genesis").digest("hex");

export class AuditCheckpointError extends Error {}

function validate(checkpoint: AuditCheckpoint, keyId: string): void {
  if (!/^[\x21-\x7e]{1,1024}$/u.test(checkpoint.origin) ||
      !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0 ||
      !/^[a-f0-9]{64}$/u.test(checkpoint.hash) || !/^[A-Za-z0-9._-]{1,80}$/u.test(keyId)) {
    throw new AuditCheckpointError("invalid checkpoint fields");
  }
}

// Signed-note key hint: first four bytes of SHA-256(name + LF +
// algorithm byte 0x01 + raw 32-byte Ed25519 public key).
function keyHint(keyId: string, key: KeyObject): Buffer {
  if (key.asymmetricKeyType !== "ed25519") throw new AuditCheckpointError("checkpoint key must be Ed25519");
  const publicKey = key.type === "private" ? createPublicKey(key) : key;
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return createHash("sha256").update(`${keyId}\n`).update(Buffer.from([1])).update(raw).digest().subarray(0, 4);
}

/** C2SP tlog-checkpoint body in a signed-note envelope. Sequence is the log size. */
export function signCheckpoint(checkpoint: AuditCheckpoint, keyId: string, privateKey: KeyObject): string {
  validate(checkpoint, keyId);
  const hint = keyHint(keyId, privateKey);
  const body = `${checkpoint.origin}\n${checkpoint.sequence}\n${Buffer.from(checkpoint.hash, "hex").toString("base64")}\n`;
  const signature = Buffer.concat([hint, sign(null, Buffer.from(body), privateKey)]).toString("base64");
  return `${body}\n— ${keyId} ${signature}\n`;
}

/** Trust comes only from the caller's public-key allowlist and expected origin. */
export function verifyCheckpoint(note: string, publicKeys: CheckpointPublicKeys, expectedOrigin?: string): AuditCheckpoint {
  const match = /^([\x21-\x7e]{1,1024})\n(0|[1-9][0-9]{0,15})\n([A-Za-z0-9+/]{43}=)\n\n— ([A-Za-z0-9._-]{1,80}) ([A-Za-z0-9+/]{91}=)\n$/u.exec(note);
  if (!match) throw new AuditCheckpointError("invalid checkpoint envelope");
  const origin = match[1]!;
  const size = match[2]!;
  const root = match[3]!;
  const keyId = match[4]!;
  const encoded = match[5]!;
  const hash = Buffer.from(root, "base64");
  const signature = Buffer.from(encoded, "base64");
  const checkpoint = { origin, sequence: Number(size), hash: hash.toString("hex") };
  validate(checkpoint, keyId);
  if (hash.toString("base64") !== root || signature.toString("base64") !== encoded || signature.length !== 68) throw new AuditCheckpointError("invalid checkpoint encoding");
  if (expectedOrigin !== undefined && origin !== expectedOrigin) throw new AuditCheckpointError("checkpoint origin mismatch");
  const key = Object.hasOwn(publicKeys, keyId) ? publicKeys[keyId] : undefined;
  if (!key) throw new AuditCheckpointError("unknown checkpoint key ID");
  const body = `${origin}\n${size}\n${root}\n`;
  if (!signature.subarray(0, 4).equals(keyHint(keyId, key)) || !verify(null, Buffer.from(body), key, signature.subarray(4))) throw new AuditCheckpointError("invalid checkpoint signature");
  return checkpoint;
}
