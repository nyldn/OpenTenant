import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signCheckpoint, verifyCheckpoint } from "./audit-checkpoint";

const a = generateKeyPairSync("ed25519");
const b = generateKeyPairSync("ed25519");
const head = { origin: "example.test/audit/installation-a/platform", sequence: 3, hash: "a".repeat(64) };

describe("signed audit checkpoints", () => {
  it("uses the signed-note envelope and verifies the origin, size, and SHA-256 head", () => {
    const note = signCheckpoint(head, "audit-2026", a.privateKey);
    expect(note).toMatch(/^example.test\/audit\/installation-a\/platform\n3\n[A-Za-z0-9+/]{43}=\n\n— audit-2026 [A-Za-z0-9+/]+=\n$/u);
    expect(verifyCheckpoint(note, { "audit-2026": a.publicKey }, head.origin)).toEqual(head);
  });
  it("supports key rotation and rejects an unknown or substituted key", () => {
    for (const [id, key] of [["old", a], ["new", b]] as const) {
      const note = signCheckpoint(head, id, key.privateKey);
      expect(verifyCheckpoint(note, { old: a.publicKey, new: b.publicKey }, head.origin)).toEqual(head);
      expect(() => verifyCheckpoint(note, { [id]: b.publicKey === key.publicKey ? a.publicKey : b.publicKey }, head.origin)).toThrow("signature");
      expect(() => verifyCheckpoint(note, {}, head.origin)).toThrow("key");
    }
  });
  it.each([
    (note: string) => note.replace("\n3\n", "\n2\n"),
    (note: string) => note.replace("example.test", "other.test"),
    (note: string) => note.replace(/\n[A-Za-z0-9+/]{43}=\n/u, `\n${Buffer.alloc(32).toString("base64")}\n`),
    (note: string) => `${note}extra\n`,
  ])("rejects altered signed fields and malformed envelopes", (tamper) => {
    expect(() => verifyCheckpoint(tamper(signCheckpoint(head, "audit", a.privateKey)), { audit: a.publicKey }, head.origin)).toThrow();
  });
  it.each([-1, 0.1, Number.MAX_SAFE_INTEGER + 1])("rejects an invalid sequence %s", (sequence) => {
    expect(() => signCheckpoint({ ...head, sequence }, "audit", a.privateKey)).toThrow();
  });
  it("rejects non-Ed25519 keys and unsafe origin or key identifiers", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => signCheckpoint(head, "audit", rsa.privateKey)).toThrow("Ed25519");
    expect(() => signCheckpoint({ ...head, origin: "origin\ninjection" }, "audit", a.privateKey)).toThrow();
    expect(() => signCheckpoint(head, "bad key", a.privateKey)).toThrow();
  });
});
