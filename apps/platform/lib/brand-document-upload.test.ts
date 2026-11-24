import { describe, expect, it } from "vitest";
import {
  BRAND_DOCUMENT_MAX_BYTES,
  BRAND_DOCUMENT_PARSER_VERSION,
} from "@opentenant/platform-core";
import {
  BRAND_DOCUMENT_UPLOAD_REQUEST_MAX_BYTES,
  parseBrandDocumentUpload,
  readBrandDocumentUpload,
} from "./brand-document-upload";

function uploadRequest(
  bytes: Uint8Array,
  options: { mediaType?: string; tenantId?: string; fileName?: string } = {},
): Request {
  const form = new FormData();
  form.set("tenantId", options.tenantId ?? "ten_example");
  form.set("action", "upload");
  form.set(
    "brandDocument",
    new File([Uint8Array.from(bytes).buffer], options.fileName ?? "brand.md", {
      type: options.mediaType ?? "text/markdown",
    }),
  );
  return new Request("https://app.example.test/api/admin/brand-proposals", {
    method: "POST",
    body: form,
  });
}

describe("brand document upload input", () => {
  it("bounds the stream before multipart parsing and accepts the exact file ceiling", async () => {
    const prefix = new TextEncoder().encode("# Display Name\nExample Organisation\n");
    const exact = new Uint8Array(BRAND_DOCUMENT_MAX_BYTES).fill(0x20);
    exact.set(prefix);

    const accepted = await readBrandDocumentUpload(uploadRequest(exact));

    expect(accepted).toMatchObject({
      ok: true,
      value: {
        kind: "upload",
        tenantId: "ten_example",
        fileName: "brand.md",
        mediaType: "text/markdown",
      },
    });
    if (accepted.ok && accepted.value.kind === "upload") {
      expect(accepted.value.bytes).toHaveLength(BRAND_DOCUMENT_MAX_BYTES);
    }

    const oversized = new Uint8Array(BRAND_DOCUMENT_MAX_BYTES + 1).fill(0x20);
    oversized.set(prefix);
    const rejected = await readBrandDocumentUpload(uploadRequest(oversized));
    expect(rejected).toEqual({
      ok: false,
      error: { code: "upload_too_large", status: 413 },
    });
  });

  it("stops an oversized request before attempting multipart parsing", async () => {
    const response = await readBrandDocumentUpload(new Request(
      "https://app.example.test/api/admin/brand-proposals",
      {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=never-parsed" },
        body: new Blob([new ArrayBuffer(BRAND_DOCUMENT_UPLOAD_REQUEST_MAX_BYTES + 1)]),
      },
    ));

    expect(response).toEqual({
      ok: false,
      error: { code: "upload_too_large", status: 413 },
    });
  });

  it("distinguishes a missing or malformed body from an oversized upload", async () => {
    const result = await readBrandDocumentUpload(new Request(
      "https://app.example.test/api/admin/brand-proposals",
      {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=missing" },
      },
    ));

    expect(result).toEqual({
      ok: false,
      error: { code: "invalid_upload", status: 400 },
    });
  });

  it.each(["text/html", "application/pdf", "application/octet-stream"])(
    "rejects unsupported media type %s",
    async (mediaType) => {
      const result = await readBrandDocumentUpload(uploadRequest(
        new TextEncoder().encode("# Display Name\nExample Organisation"),
        { mediaType },
      ));
      expect(result).toEqual({
        ok: false,
        error: { code: "unsupported_media_type", status: 415 },
      });
    },
  );

  it("rejects malformed multipart fields and multiple files", async () => {
    const bytes = new TextEncoder().encode("# Display Name\nExample Organisation");
    const form = new FormData();
    form.set("tenantId", "ten_example");
    form.set("action", "upload");
    form.append("brandDocument", new File([Uint8Array.from(bytes).buffer], "one.md", { type: "text/markdown" }));
    form.append("brandDocument", new File([Uint8Array.from(bytes).buffer], "two.md", { type: "text/markdown" }));

    const result = await readBrandDocumentUpload(new Request(
      "https://app.example.test/api/admin/brand-proposals",
      { method: "POST", body: form },
    ));
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid_upload", status: 400 },
    });
  });
});

describe("brand document upload parsing", () => {
  const uploadedAt = new Date("2026-09-06T15:00:00.000Z");

  it("hashes the original bytes and returns parser values without document content", () => {
    const bytes = new TextEncoder().encode(
      "# Display Name\nExample Organisation\n\n```brand\ncolorPrimary: #123456\n```\n",
    );
    const result = parseBrandDocumentUpload(bytes, "usr_admin", uploadedAt);

    expect(result).toEqual({
      ok: true,
      value: {
        fileDigest: "17d9025e763ac1bfdc40372f6c57a59a0996af3dcdf47351c99090c2974372e7",
        parserVersion: BRAND_DOCUMENT_PARSER_VERSION,
        values: {
          colorPrimary: "#123456",
          displayName: "Example Organisation",
        },
      },
    });
    expect(result).not.toHaveProperty("value.bytes");
  });

  it("rejects invalid UTF-8 and files with no recognized values", () => {
    expect(parseBrandDocumentUpload(
      new Uint8Array([0x23, 0x20, 0x80]),
      "usr_admin",
      uploadedAt,
    )).toEqual({
      ok: false,
      error: { code: "invalid_encoding", status: 422 },
    });

    const noValues = parseBrandDocumentUpload(
      new TextEncoder().encode("# Tone\nFriendly\n"),
      "usr_admin",
      uploadedAt,
    );
    expect(noValues).toEqual({
      ok: false,
      error: {
        code: "invalid_document",
        status: 422,
        issues: ["brand.md contained 0 recognised keys; headings found: Tone"],
      },
    });
  });

  it("rejects the whole upload with bounded per-key parser reasons", () => {
    const result = parseBrandDocumentUpload(
      new TextEncoder().encode(`
# Display Name
Example Organisation

\`\`\`brand
displayName: Duplicate
coBrandingRequired: maybe
\`\`\`
`),
      "usr_admin",
      uploadedAt,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_document",
        status: 422,
        issues: [
          "displayName: duplicate key",
          "coBrandingRequired: coBrandingRequired must be true or false",
        ],
      },
    });
  });
});
