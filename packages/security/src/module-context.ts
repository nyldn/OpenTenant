/**
 * Signed module context (architecture spec section 11, remote runtime;
 * ADR-003). The platform mints a short-lived Ed25519-signed token carrying
 * the already-resolved tenant, user, permissions, and brand. A remote module
 * verifies it with the platform's public key and trusts nothing else: it
 * never calls the identity provider or the control plane directly.
 *
 * Ed25519 is asymmetric on purpose. The module holds only the public key, so
 * a module compromise cannot mint contexts.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export interface ModuleContextClaims {
  tenantId: string;
  moduleKey: string;
  moduleVersion: string;
  userId: string | null;
  permissions: string[];
  brand: { displayName: string; logoUrl: string | null; cssBrandKey: string };
  /** Unix seconds. */
  issuedAt: number;
  expiresAt: number;
}

const CONTEXT_TTL_SECONDS = 120;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/u;
const moduleKeyPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const moduleVersionPattern = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u;
const permissionPattern = /^[a-z][a-z0-9._:-]{0,127}$/u;

function structurallyValidClaims(value: unknown): value is ModuleContextClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Partial<ModuleContextClaims>;
  return typeof claims.tenantId === "string"
    && identifierPattern.test(claims.tenantId)
    && typeof claims.moduleKey === "string"
    && moduleKeyPattern.test(claims.moduleKey)
    && typeof claims.moduleVersion === "string"
    && moduleVersionPattern.test(claims.moduleVersion)
    && (claims.userId === null
      || (typeof claims.userId === "string" && identifierPattern.test(claims.userId)))
    && Array.isArray(claims.permissions)
    && claims.permissions.length <= 256
    && claims.permissions.every((permission) => (
      typeof permission === "string" && permissionPattern.test(permission)
    ))
    && typeof claims.brand === "object"
    && claims.brand !== null
    && typeof claims.brand.displayName === "string"
    && claims.brand.displayName.length > 0
    && claims.brand.displayName.length <= 160
    && (claims.brand.logoUrl === null
      || (typeof claims.brand.logoUrl === "string"
        && claims.brand.logoUrl.length <= 2048
        && !/[\u0000-\u001f]/u.test(claims.brand.logoUrl)))
    && typeof claims.brand.cssBrandKey === "string"
    && /^[a-z0-9-]{1,32}$/u.test(claims.brand.cssBrandKey)
    && Number.isInteger(claims.issuedAt)
    && Number.isInteger(claims.expiresAt)
    && (claims.expiresAt as number) > (claims.issuedAt as number);
}

function encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/**
 * @param privateKeyPem Ed25519 private key (PKCS8 PEM) from a deployment
 * secret. Never leaves the platform.
 */
export function signModuleContext(
  claims: Omit<ModuleContextClaims, "issuedAt" | "expiresAt">,
  privateKeyPem: string,
  now: number = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000);
  const full: ModuleContextClaims = { ...claims, issuedAt, expiresAt: issuedAt + CONTEXT_TTL_SECONDS };
  const payload = encode(full);
  const signature = sign(null, Buffer.from(payload), createPrivateKey(privateKeyPem)).toString("base64url");
  return `${payload}.${signature}`;
}

export type ModuleContextResult =
  | { valid: true; claims: ModuleContextClaims }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * @param publicKeyPem Ed25519 public key (SPKI PEM). Safe to ship to modules.
 */
export function verifyModuleContext(
  token: string,
  publicKeyPem: string,
  expected: { moduleKey: string; moduleVersion?: string },
  now: number = Date.now(),
): ModuleContextResult {
  const dot = token.indexOf(".");
  if (dot <= 0) return { valid: false, reason: "malformed" };
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let ok = false;
  try {
    ok = verify(null, Buffer.from(payload), createPublicKey(publicKeyPem), Buffer.from(signature, "base64url"));
  } catch {
    return { valid: false, reason: "bad_signature" };
  }
  if (!ok) return { valid: false, reason: "bad_signature" };

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (!structurallyValidClaims(decoded)) return { valid: false, reason: "malformed" };
  const claims = decoded;
  if (
    claims.moduleKey !== expected.moduleKey
    || (expected.moduleVersion !== undefined && claims.moduleVersion !== expected.moduleVersion)
  ) return { valid: false, reason: "bad_signature" };
  if (typeof claims.expiresAt !== "number" || claims.expiresAt <= Math.floor(now / 1000)) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, claims };
}
