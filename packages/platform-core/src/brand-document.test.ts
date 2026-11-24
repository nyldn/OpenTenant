import { describe, expect, it } from "vitest";
import {
  BRAND_DOCUMENT_MAX_BYTES,
  BRAND_DOCUMENT_MAX_KEYS,
  BRAND_DOCUMENT_PARSER_VERSION,
  parseBrandDocument,
} from "./brand-document";

const provenance = {
  kind: "upload" as const,
  fileDigest: "c".repeat(64),
  uploadedByUserId: "usr_admin_t1",
  uploadedAt: new Date("2026-07-28T12:00:00.000Z"),
};

describe("parseBrandDocument", () => {
  it("extracts recognised keys from headings and fenced blocks", () => {
    const document = new TextEncoder().encode(`
# Display Name
Example Organisation

## Notes
Ignored

\`\`\`brand
colorPrimary: #112233
coBrandingRequired: true
\`\`\`
`);
    const parsed = parseBrandDocument(document, provenance);
    expect(parsed.parserVersion).toBe(BRAND_DOCUMENT_PARSER_VERSION);
    expect(parsed.parserVersion).toBe("brand-md-v1");
    expect(parsed.extracted.map((entry) => entry.key).sort()).toEqual([
      "coBrandingRequired",
      "colorPrimary",
      "displayName",
    ]);
    expect(parsed.values.displayName?.provenance.kind).toBe("upload");
    expect(parsed.values.displayName?.provenance).not.toHaveProperty("sourceUrl");
  });

  it("rejects duplicate and malformed recognised values without silently accepting them", () => {
    const document = new TextEncoder().encode(`
# Display Name
Example Organisation

\`\`\`brand
displayName: Duplicate
coBrandingRequired: maybe
\`\`\`
`);
    const parsed = parseBrandDocument(document, provenance);
    expect(parsed.rejections).toEqual([
      { key: "displayName", reason: "duplicate key", location: "fence" },
      { key: "coBrandingRequired", reason: "coBrandingRequired must be true or false", location: "fence" },
    ]);
    expect(parsed.values.displayName?.value).toBe("Example Organisation");
  });

  it("flags conflicting recognised headings separately from duplicate keys", () => {
    const document = new TextEncoder().encode(`
# Display Name
Example Organisation

## displayName
Conflicting Alias
`);

    const parsed = parseBrandDocument(document, provenance);
    expect(parsed.rejections).toEqual([
      { key: "displayName", reason: "conflicting heading", location: "heading" },
    ]);
    expect(parsed.values.displayName?.value).toBe("Example Organisation");
  });

  it("errors when no recognised keys are found and reports the headings it saw", () => {
    const document = new TextEncoder().encode(`
# Tone
Friendly

## Mission
Be useful
`);
    expect(() => parseBrandDocument(document, provenance)).toThrow(
      "brand.md contained 0 recognised keys; headings found: Tone, Mission",
    );
  });

  it("enforces the file-size and extracted-key ceilings at their boundaries", () => {
    // Padded with spaces, not the zero fill a bare Uint8Array gives. NUL bytes
    // are not whitespace, so a zero-filled tail became part of the heading's
    // value and was correctly refused as unsafe text, which tested NUL handling
    // rather than the size boundary this case is about.
    const prefix = new TextEncoder().encode("# Display Name\nExample Organisation\n");
    const exactBytes = new Uint8Array(BRAND_DOCUMENT_MAX_BYTES).fill(0x20);
    exactBytes.set(prefix, 0);
    expect(() => parseBrandDocument(exactBytes, provenance)).not.toThrow();

    const overBytes = new Uint8Array(BRAND_DOCUMENT_MAX_BYTES + 1).fill(0x20);
    overBytes.set(prefix, 0);
    expect(() => parseBrandDocument(overBytes, provenance)).toThrow(
      `brand.md exceeds ${BRAND_DOCUMENT_MAX_BYTES} bytes`,
    );

    const keysAtLimit = new TextEncoder().encode(
      Array.from({ length: BRAND_DOCUMENT_MAX_KEYS }, (_, index) => (
        `\`\`\`brand\ncssBrandKey: key-${index}\n\`\`\``
      )).join("\n"),
    );
    expect(() => parseBrandDocument(keysAtLimit, provenance)).not.toThrow();

    const keysOverLimit = new TextEncoder().encode(
      Array.from({ length: BRAND_DOCUMENT_MAX_KEYS + 1 }, (_, index) => (
        `\`\`\`brand\ncssBrandKey: key-${index}\n\`\`\``
      )).join("\n"),
    );
    expect(() => parseBrandDocument(keysOverLimit, provenance)).toThrow(
      `brand.md exceeds the ${BRAND_DOCUMENT_MAX_KEYS} extracted-key ceiling`,
    );
  });
});
