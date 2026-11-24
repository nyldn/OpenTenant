import type { BrandTokenKey, BrandTokens } from "./branding";
import type {
  ProposedBrandValue,
  ProposedBrandValues,
  UploadBrandValueProvenance,
} from "./brand-proposal";
import { parseBrandTokenValue } from "./brand-validation";

export const BRAND_DOCUMENT_MAX_BYTES = 256 * 1024;
export const BRAND_DOCUMENT_MAX_KEYS = 64;
export const BRAND_DOCUMENT_PARSER_VERSION = "brand-md-v1";
export type BrandDocumentParserVersion = typeof BRAND_DOCUMENT_PARSER_VERSION;

export interface ParsedBrandDocumentKey<K extends BrandTokenKey = BrandTokenKey> {
  key: K;
  value: BrandTokens[K];
}

export interface ParsedBrandDocumentRejection {
  key: string;
  reason: string;
  location: "heading" | "fence";
}

export interface ParsedBrandDocument {
  parserVersion: BrandDocumentParserVersion;
  headingsFound: string[];
  values: ProposedBrandValues;
  extracted: ParsedBrandDocumentKey[];
  rejections: ParsedBrandDocumentRejection[];
}

const textDecoder = new TextDecoder();

const HEADING_KEY_ALIASES = new Map<string, BrandTokenKey>([
  ["display name", "displayName"],
  ["displayname", "displayName"],
  ["logo url", "logoUrl"],
  ["mark url", "markUrl"],
  ["favicon url", "faviconUrl"],
  ["css brand key", "cssBrandKey"],
  ["brand key", "cssBrandKey"],
  ["primary color", "colorPrimary"],
  ["background color", "colorBackground"],
  ["foreground color", "colorForeground"],
  ["body font family", "fontFamilyBody"],
  ["heading font family", "fontFamilyHeading"],
  ["support email", "supportEmail"],
  ["legal links", "legalLinks"],
  ["report label", "reportLabel"],
  ["export filename suffix", "exportFilenameSuffix"],
  ["co-branding required", "coBrandingRequired"],
  ["cobranding required", "coBrandingRequired"],
]);

for (const key of [
  "displayName",
  "logoUrl",
  "markUrl",
  "faviconUrl",
  "cssBrandKey",
  "colorPrimary",
  "colorBackground",
  "colorForeground",
  "fontFamilyBody",
  "fontFamilyHeading",
  "supportEmail",
  "legalLinks",
  "reportLabel",
  "exportFilenameSuffix",
  "coBrandingRequired",
] as const) {
  HEADING_KEY_ALIASES.set(key.toLowerCase(), key);
}

/**
 * Writes one key into a partial brand-token record.
 *
 * TypeScript will not verify a write through a generic key into a mapped type:
 * `values[key] = v` asks for a value assignable to every member of the union at
 * once and reduces the target to `never`. The signature makes the call site
 * type-safe, so the cast stays confined to this line rather than being repeated
 * by every caller, which is how a real mismatch would eventually slip through.
 */
function setProposedValue<K extends BrandTokenKey>(
  values: ProposedBrandValues,
  key: K,
  value: ProposedBrandValue<K>,
): void {
  (values as Record<BrandTokenKey, ProposedBrandValue>)[key] = value as ProposedBrandValue;
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function keyForHeading(value: string): BrandTokenKey | null {
  return HEADING_KEY_ALIASES.get(normalizeHeading(value)) ?? null;
}

/**
 * Generic in the key so the assignment below keeps its per-key value type.
 *
 * Written non-generically, `key` is the whole `BrandTokenKey` union, so
 * `values[key] = ...` demands a value assignable to *every* member at once.
 * TypeScript reduces that intersection to `never` and the write can only be
 * forced through with a cast, which discards the type checking the record
 * exists to provide. Binding one `K` per call keeps it honest.
 */
function assignParsedValue<K extends BrandTokenKey>(
  values: ProposedBrandValues,
  extracted: ParsedBrandDocumentKey[],
  rejections: ParsedBrandDocumentRejection[],
  assignedFrom: Map<BrandTokenKey, { location: "heading" | "fence"; label: string }>,
  key: K,
  rawValue: string,
  location: "heading" | "fence",
  label: string,
  provenance: UploadBrandValueProvenance,
): void {
  const existing = assignedFrom.get(key);
  if (existing) {
    rejections.push({
      key,
      reason: existing.location === "heading" && location === "heading" && existing.label !== label
        ? "conflicting heading"
        : "duplicate key",
      location,
    });
    return;
  }
  const parsed = parseBrandTokenValue(key, rawValue);
  if (!parsed.ok) {
    rejections.push({ key, reason: parsed.reason, location });
    return;
  }
  setProposedValue(values, key, { value: parsed.value, provenance });
  extracted.push({ key, value: parsed.value });
  assignedFrom.set(key, { location, label });
}

export function parseBrandDocument(
  fileBytes: Uint8Array,
  provenance: UploadBrandValueProvenance,
): ParsedBrandDocument {
  if (fileBytes.byteLength > BRAND_DOCUMENT_MAX_BYTES) {
    throw new Error(`brand.md exceeds ${BRAND_DOCUMENT_MAX_BYTES} bytes`);
  }
  const source = textDecoder.decode(fileBytes);
  const values: ProposedBrandValues = {};
  const extracted: ParsedBrandDocumentKey[] = [];
  const rejections: ParsedBrandDocumentRejection[] = [];
  const headingsFound: string[] = [];
  const assignedFrom = new Map<BrandTokenKey, { location: "heading" | "fence"; label: string }>();

  const headingMatches = [...source.matchAll(/^#{1,6}\s+(.+?)\s*$/gmu)];
  let recognisedCandidates = 0;
  for (let index = 0; index < headingMatches.length; index += 1) {
    const match = headingMatches[index]!;
    const heading = match[1]!.trim();
    headingsFound.push(heading);
    const key = keyForHeading(heading);
    if (key === null) continue;
    recognisedCandidates += 1;
    const sectionStart = match.index! + match[0].length;
    const sectionEnd = headingMatches[index + 1]?.index ?? source.length;
    // Excise fenced blocks whole. Deleting only the ``` delimiter lines left
    // the fence *contents* inside the heading's section, because a section runs
    // to the next heading rather than to the next block. A document with one
    // heading followed by a brand fence therefore made the heading's value the
    // entire fence body, which then failed the single-line text check and was
    // reported as an out-of-bounds heading value rather than parsed as the two
    // separate sources it is.
    const section = source.slice(sectionStart, sectionEnd)
      .replace(/^```[\w-]*\r?\n[\s\S]*?^```[^\S\r\n]*$/gmu, "")
      .replace(/^```[\w-]*[^\S\r\n]*$/gmu, "")
      .trim();
    if (!section) {
      rejections.push({ key, reason: "recognised heading had no value", location: "heading" });
      continue;
    }
    assignParsedValue(
      values,
      extracted,
      rejections,
      assignedFrom,
      key,
      section,
      "heading",
      normalizeHeading(heading),
      provenance,
    );
  }

  const fenceMatches = [...source.matchAll(/```[\w-]*\s*\n([\s\S]*?)```/gmu)];
  for (const fence of fenceMatches) {
    for (const line of fence[1]!.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const candidate = trimmed.match(/^([A-Za-z][A-Za-z0-9 _-]*)\s*[:=]\s*(.+)$/u);
      if (!candidate) continue;
      const key = keyForHeading(candidate[1]!);
      if (key === null) continue;
      recognisedCandidates += 1;
      assignParsedValue(
        values,
        extracted,
        rejections,
        assignedFrom,
        key,
        candidate[2]!,
        "fence",
        normalizeHeading(candidate[1]!),
        provenance,
      );
    }
  }

  if (recognisedCandidates > BRAND_DOCUMENT_MAX_KEYS) {
    throw new Error(`brand.md exceeds the ${BRAND_DOCUMENT_MAX_KEYS} extracted-key ceiling`);
  }

  if (extracted.length === 0) {
    const headings = headingsFound.length > 0 ? headingsFound.join(", ") : "none";
    throw new Error(`brand.md contained 0 recognised keys; headings found: ${headings}`);
  }

  return {
    parserVersion: BRAND_DOCUMENT_PARSER_VERSION,
    headingsFound,
    values,
    extracted,
    rejections,
  };
}
