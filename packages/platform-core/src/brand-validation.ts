import type { BrandTokenKey, BrandTokens } from "./branding";

export interface BrandTokenValidationSuccess<K extends BrandTokenKey = BrandTokenKey> {
  ok: true;
  value: BrandTokens[K];
}

export interface BrandTokenValidationFailure {
  ok: false;
  reason: string;
}

export type BrandTokenValidationResult<K extends BrandTokenKey = BrandTokenKey> =
  | BrandTokenValidationSuccess<K>
  | BrandTokenValidationFailure;

type BrandTokenRecord = Record<BrandTokenKey, unknown>;

const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,2048}$/u;
const SAFE_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u;
const SAFE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SAFE_ASSET = /^(?:\/[A-Za-z0-9._/-]+|https:\/\/[^\s]{1,2040})$/u;

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function nullableString(value: unknown): string | null | typeof INVALID {
  if (value === null) return null;
  const candidate = stringValue(value);
  if (candidate === null) return INVALID;
  if (candidate === "" || candidate.toLowerCase() === "null" || candidate.toLowerCase() === "none") return null;
  return candidate;
}

function arrayRecord(value: unknown): ReadonlyArray<Record<string, unknown>> | null {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
    ? (value as ReadonlyArray<Record<string, unknown>>)
    : null;
}

const INVALID = Symbol("invalid");

function validateString(
  value: unknown,
  label: string,
  options: { maxLength: number; pattern?: RegExp; nullable?: boolean } = { maxLength: 2048 },
): BrandTokenValidationResult {
  const candidate = options.nullable ? nullableString(value) : stringValue(value);
  if (candidate === INVALID || candidate === null) {
    return options.nullable && candidate === null
      ? { ok: true, value: null }
      : { ok: false, reason: `${label} must be text` };
  }
  if (candidate.length < 1 || candidate.length > options.maxLength || !SAFE_TEXT.test(candidate)) {
    return { ok: false, reason: `${label} is out of bounds` };
  }
  if (options.pattern && !options.pattern.test(candidate)) {
    return { ok: false, reason: `${label} is not in an accepted format` };
  }
  return { ok: true, value: candidate };
}

function validateLegalLinks(value: unknown): BrandTokenValidationResult<"legalLinks"> {
  const links = arrayRecord(value);
  if (links === null) return { ok: false, reason: "legalLinks must be an array of { label, url } objects" };
  if (links.length > 20) return { ok: false, reason: "legalLinks accepts at most 20 entries" };
  const normalized: Array<{ label: string; url: string }> = [];
  for (const link of links) {
    const label = stringValue(link.label);
    const url = stringValue(link.url);
    if (!label || label.length > 120 || !SAFE_TEXT.test(label)) {
      return { ok: false, reason: "legalLinks labels must be safe text up to 120 characters" };
    }
    if (!url || !/^https:\/\/[^\s]{1,2040}$/u.test(url)) {
      return { ok: false, reason: "legalLinks URLs must be HTTPS" };
    }
    normalized.push({ label, url });
  }
  return { ok: true, value: normalized };
}

function parseJsonCandidate(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return INVALID;
  }
}

/**
 * Generic in the key so a caller writing into `ProposedBrandValues` keeps the
 * per-key value type. Returning the bare union forces the caller to cast, and
 * the cast is what hides a genuine mismatch between a parsed value and the key
 * it was parsed for.
 */
function parseBrandToken<K extends BrandTokenKey>(
  key: K,
  rawValue: string,
  parseJsonText: boolean,
): BrandTokenValidationResult<K> {
  const trimmed = rawValue.trim();
  const validate = (candidate: unknown): BrandTokenValidationResult<K> =>
    validateBrandTokenValue(key, candidate);
  switch (key) {
    case "coBrandingRequired":
      if (/^(?:true|yes|on)$/iu.test(trimmed)) return validate(true);
      if (/^(?:false|no|off)$/iu.test(trimmed)) return validate(false);
      return { ok: false, reason: "coBrandingRequired must be true or false" };
    case "legalLinks": {
      const parsed = parseJsonCandidate(trimmed);
      if (parsed !== INVALID) return validate(parsed);
      const items = trimmed
        .split(/\r?\n/u)
        .map((line) => line.replace(/^\s*[-*]\s*/u, "").trim())
        .filter(Boolean)
        .map((line) => {
          const [label, url] = line.split(/\s+\|\s+/u, 2);
          return { label, url };
        });
      return validate(items);
    }
    case "logoUrl":
    case "markUrl":
    case "faviconUrl":
      return validate(nullableString(trimmed));
    default: {
      if (parseJsonText) {
        const parsed = parseJsonCandidate(trimmed);
        if (parsed !== INVALID) return validate(parsed);
      }
      return validate(trimmed);
    }
  }
}

/**
 * Parser contract used by immutable brand document versions. Do not change its
 * coercion semantics without introducing and registering a new parser version.
 */
export function parseBrandTokenValue<K extends BrandTokenKey>(
  key: K,
  rawValue: string,
): BrandTokenValidationResult<K> {
  return parseBrandToken(key, rawValue, true);
}

/** Parses values from operator text inputs without JSON-coercing text tokens. */
export function parseBrandTokenInput<K extends BrandTokenKey>(
  key: K,
  rawValue: string,
): BrandTokenValidationResult<K> {
  return parseBrandToken(key, rawValue, false);
}

export function validateBrandTokenValue<K extends BrandTokenKey>(
  key: K,
  value: unknown,
): BrandTokenValidationResult<K> {
  const asRecord = value as BrandTokenRecord[K];
  switch (key) {
    case "displayName":
      return validateString(asRecord, key, { maxLength: 160 }) as BrandTokenValidationResult<K>;
    case "logoUrl":
    case "markUrl":
    case "faviconUrl": {
      const result = validateString(asRecord, key, {
        maxLength: 2048,
        pattern: SAFE_ASSET,
        nullable: true,
      });
      return result as BrandTokenValidationResult<K>;
    }
    case "cssBrandKey":
      return validateString(asRecord, key, {
        maxLength: 32,
        pattern: /^[a-z0-9-]{1,32}$/u,
      }) as BrandTokenValidationResult<K>;
    case "colorPrimary":
    case "colorBackground":
    case "colorForeground":
      return validateString(asRecord, key, {
        maxLength: 7,
        pattern: SAFE_COLOR,
      }) as BrandTokenValidationResult<K>;
    case "fontFamilyBody":
    case "fontFamilyHeading":
      return validateString(asRecord, key, {
        maxLength: 160,
      }) as BrandTokenValidationResult<K>;
    case "supportEmail":
      return validateString(asRecord, key, {
        maxLength: 254,
        pattern: SAFE_EMAIL,
        nullable: true,
      }) as BrandTokenValidationResult<K>;
    case "legalLinks":
      return validateLegalLinks(asRecord) as BrandTokenValidationResult<K>;
    case "reportLabel":
      return validateString(asRecord, key, {
        maxLength: 120,
        nullable: true,
      }) as BrandTokenValidationResult<K>;
    case "exportFilenameSuffix":
      return validateString(asRecord, key, {
        maxLength: 20,
        pattern: /^[a-z0-9-]{1,20}$/u,
        nullable: true,
      }) as BrandTokenValidationResult<K>;
    case "coBrandingRequired":
      // The cast belongs to the whole ternary. Attached to the failure arm
      // alone it left the success arm as BrandTokenRecord[K] & boolean, which
      // is not assignable to BrandTokens[K] for a generic K.
      return (typeof asRecord === "boolean"
        ? { ok: true, value: asRecord }
        : { ok: false, reason: "coBrandingRequired must be boolean" }) as BrandTokenValidationResult<K>;
    default:
      return { ok: false, reason: `Unsupported brand token key ${String(key)}` };
  }
}
