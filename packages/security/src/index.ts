/**
 * Audit contract (architecture spec section 14): privileged operations write
 * append-only, tamper-evident events with full actor attribution. Events are
 * content-free with respect to module data; payloads carry identifiers
 * and configuration values, never client content.
 */

export type AuditActor =
  | { kind: "user"; userId: string }
  | { kind: "installation_owner"; userId: string }
  | { kind: "platform_admin"; userId: string }
  | { kind: "system"; job: string };

export interface AuditEvent {
  /** Monotonic per-scope sequence assigned by the store, part of the hash chain. */
  sequence: number;
  occurredAt: Date;
  actor: AuditActor;
  /** Null for platform-scoped events. */
  tenantId: string | null;
  /** Dplatform-namespaced action, e.g. "tenant.suspend", "domain.remove", "member.role_change". */
  action: string;
  /** Affected resource identifier, e.g. a host, membership id, or module key. */
  subject: string;
  /** Identifiers and configuration only; never module content. */
  detail: Readonly<Record<string, string | number | boolean | null>>;
  /** SHA-256 over canonical JSON of previousHash, sequence, tenantId, timestamp, actor, action, subject, and detail. */
  previousHash: string;
  hash: string;
}

export interface AuditWriter {
  /** Appends the event, computing sequence and hash chain fields. */
  append(
    event: Omit<AuditEvent, "sequence" | "hash" | "previousHash">,
  ): Promise<AuditEvent>;
}

export type AuditChainAssurance = "empty" | "canonical" | "legacy-unbound" | "unverified";
export type AuditChainFailure =
  | "sequence_gap"
  | "previous_hash_mismatch"
  | "hash_mismatch"
  | "format_downgrade"
  | null;

export interface AuditChainVerification {
  intact: boolean;
  brokenAtSequence: number | null;
  /** The weakest guarantee present in the verified chain. */
  assurance: AuditChainAssurance;
  /** First event whose canonical hash binds tenant scope, if one exists. */
  canonicalFromSequence: number | null;
  failure: AuditChainFailure;
}

export interface AuditReader {
  listForTenant(tenantId: string, limit: number): Promise<AuditEvent[]>;
  /** Recomputes the hash chain and reports the first break, if any. */
  verifyChain(tenantId: string | null): Promise<AuditChainVerification>;
}

/* ── Module access tokens ─────────────────────────────────────────────────
 * Signed, expiring grants for passcode-mode module access (server-side
 * replacement for the source repo's client-side gate). The token binds
 * tenant, module, the passcode it was issued under, and expiry under an
 * HMAC, so rotating the passcode revokes every outstanding grant. No session
 * or user identity is implied. Secret comes from a deployment secret and never leaves the
 * server.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ModuleAccessGrant {
  tenantId: string;
  moduleKey: string;
  /** Opaque digest of the passcode policy the grant was issued under. */
  policyBinding: string;
  expiresAt: number;
}

export function signModuleAccess(grant: ModuleAccessGrant, secret: string): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyModuleAccess(
  token: string,
  expected: { tenantId: string; moduleKey: string; policyBinding: string },
  secret: string,
  now: number = Date.now(),
): boolean {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const good = createHmac("sha256", secret).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return false;
  }
  if (given.length !== good.length || !timingSafeEqual(given, good)) return false;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ModuleAccessGrant;
    return (
      grant.tenantId === expected.tenantId &&
      grant.moduleKey === expected.moduleKey &&
      expected.policyBinding.length > 0 &&
      grant.policyBinding === expected.policyBinding &&
      typeof grant.expiresAt === "number" &&
      grant.expiresAt > now
    );
  } catch {
    return false;
  }
}

/* ── Passcode hashing (scrypt) ──────────────────────────────────────────── */
import { randomBytes as randomBytesScrypt, scryptSync } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export function hashPasscode(passcode: string): string {
  const salt = randomBytesScrypt(16);
  const hash = scryptSync(passcode, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  if (
    nStr !== String(SCRYPT_N) ||
    rStr !== String(SCRYPT_R) ||
    pStr !== String(SCRYPT_P) ||
    !/^[A-Za-z0-9_-]{22}$/u.test(saltB64!) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(hashB64!)
  ) {
    return false;
  }
  const salt = Buffer.from(saltB64!, "base64url");
  const expected = Buffer.from(hashB64!, "base64url");
  if (
    salt.length !== 16 ||
    expected.length !== SCRYPT_KEYLEN ||
    salt.toString("base64url") !== saltB64 ||
    expected.toString("base64url") !== hashB64
  ) {
    return false;
  }
  const actual = scryptSync(passcode, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return timingSafeEqual(actual, expected);
}

export {
  SyntheticEvidenceExportAdapter,
  createEvidenceScopeVersion,
  verifyEvidenceExport,
} from "./evidence-export";
export type {
  EvidenceExport,
  EvidenceExportAuthorization,
  EvidenceExportRequest,
  EvidenceExportSourceRecord,
  EvidenceReconciliation,
  EvidenceScopeKind,
  EvidenceScopeVersion,
  EvidenceScopeVersionInput,
  ExportedEvidenceRecord,
} from "./evidence-export";

export {
  signModuleContext,
  verifyModuleContext,
} from "./module-context";
export type { ModuleContextClaims, ModuleContextResult } from "./module-context";
export { canonicalJsonStringify } from "./canonical-json";
export { projectTenantActivity, TENANT_ACTIVITY_ACTION_POLICY } from "./tenant-activity";
export type {
  TenantActivityAction,
  TenantActivityMetadataValue,
  TenantActivityRecord,
} from "./tenant-activity";

export { oauthVaultAad } from "./oauth-vault";
