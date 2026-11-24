import { createHash } from "node:crypto";
import {
  BRAND_DOCUMENT_MAX_BYTES,
  BRAND_DOCUMENT_PARSER_VERSION,
  parseBrandDocument,
  type BrandTokens,
} from "@opentenant/platform-core";

const MULTIPART_OVERHEAD_MAX_BYTES = 16 * 1024;
export const BRAND_DOCUMENT_UPLOAD_REQUEST_MAX_BYTES =
  BRAND_DOCUMENT_MAX_BYTES + MULTIPART_OVERHEAD_MAX_BYTES;
const ACCEPTED_MEDIA_TYPES = new Set(["text/markdown", "text/plain"]);
const MAX_FILE_NAME_CHARACTERS = 255;
const MAX_ISSUE_CHARACTERS = 512;

export type BrandDocumentUploadErrorCode =
  | "invalid_upload"
  | "upload_too_large"
  | "unsupported_media_type"
  | "invalid_encoding"
  | "invalid_document";

export interface BrandDocumentUploadError {
  readonly code: BrandDocumentUploadErrorCode;
  readonly status: 400 | 413 | 415 | 422;
  readonly issues?: readonly string[];
}

export interface BrandDocumentUploadForm {
  readonly kind: "upload";
  readonly tenantId: string;
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly mediaType: "text/markdown" | "text/plain";
}

export interface BoundedMultipartForm {
  readonly kind: "form";
  readonly form: FormData;
}

export interface ParsedBrandDocumentUpload {
  readonly fileDigest: string;
  readonly parserVersion: typeof BRAND_DOCUMENT_PARSER_VERSION;
  readonly values: Readonly<Partial<BrandTokens>>;
}

export type BrandDocumentUploadReadResult =
  | { readonly ok: true; readonly value: BrandDocumentUploadForm | BoundedMultipartForm }
  | { readonly ok: false; readonly error: BrandDocumentUploadError };

export type ParsedBrandDocumentUploadResult =
  | { readonly ok: true; readonly value: ParsedBrandDocumentUpload }
  | { readonly ok: false; readonly error: BrandDocumentUploadError };

function failure(
  code: BrandDocumentUploadErrorCode,
  status: BrandDocumentUploadError["status"],
  issues?: readonly string[],
): { readonly ok: false; readonly error: BrandDocumentUploadError } {
  return { ok: false, error: { code, status, ...(issues ? { issues } : {}) } };
}

type BoundedRequestResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: BrandDocumentUploadError };

async function readBoundedRequest(req: Request): Promise<BoundedRequestResult> {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return failure("invalid_upload", 400);
    }
    if (parsedLength > BRAND_DOCUMENT_UPLOAD_REQUEST_MAX_BYTES) {
      return failure("upload_too_large", 413);
    }
  }
  if (!req.body) return failure("invalid_upload", 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BRAND_DOCUMENT_UPLOAD_REQUEST_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return failure("upload_too_large", 413);
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return failure("invalid_upload", 400);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function readBrandDocumentUpload(req: Request): Promise<BrandDocumentUploadReadResult> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/iu.test(contentType)) {
    return failure("invalid_upload", 400);
  }
  const request = await readBoundedRequest(req);
  if (!request.ok) return request;

  let form: FormData;
  try {
    form = await new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: new Blob([Uint8Array.from(request.bytes).buffer]),
    }).formData();
  } catch {
    return failure("invalid_upload", 400);
  }

  const fieldNames = [...form.keys()];
  if (form.get("action") !== "upload") {
    return { ok: true, value: { kind: "form", form } };
  }
  if (
    fieldNames.length !== 3
    || new Set(fieldNames).size !== 3
    || !fieldNames.includes("tenantId")
    || !fieldNames.includes("action")
    || !fieldNames.includes("brandDocument")
  ) {
    return failure("invalid_upload", 400);
  }
  const tenantId = form.get("tenantId");
  const action = form.get("action");
  const files = form.getAll("brandDocument");
  if (
    typeof tenantId !== "string"
    || !/^[a-z][a-z0-9_-]{2,63}$/u.test(tenantId)
    || action !== "upload"
    || files.length !== 1
    || !(files[0] instanceof File)
  ) {
    return failure("invalid_upload", 400);
  }
  const file = files[0];
  if (
    file.name.length === 0
    || [...file.name].length > MAX_FILE_NAME_CHARACTERS
    || !/\.md$/iu.test(file.name)
  ) {
    return failure("invalid_upload", 400);
  }
  const mediaType = file.type.toLowerCase();
  if (!ACCEPTED_MEDIA_TYPES.has(mediaType)) {
    return failure("unsupported_media_type", 415);
  }
  if (file.size > BRAND_DOCUMENT_MAX_BYTES) return failure("upload_too_large", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > BRAND_DOCUMENT_MAX_BYTES) return failure("upload_too_large", 413);
  return {
    ok: true,
    value: {
      kind: "upload",
      tenantId,
      bytes,
      fileName: file.name,
      mediaType: mediaType as BrandDocumentUploadForm["mediaType"],
    },
  };
}

function boundedIssue(message: string): string {
  return [...message].slice(0, MAX_ISSUE_CHARACTERS).join("");
}

export function parseBrandDocumentUpload(
  bytes: Uint8Array,
  uploadedByUserId: string,
  uploadedAt: Date,
): ParsedBrandDocumentUploadResult {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure("invalid_encoding", 422);
  }

  const fileDigest = createHash("sha256").update(bytes).digest("hex");
  try {
    const parsed = parseBrandDocument(bytes, {
      kind: "upload",
      fileDigest,
      uploadedByUserId,
      uploadedAt,
    });
    if (parsed.rejections.length > 0) {
      return failure(
        "invalid_document",
        422,
        parsed.rejections.map((rejection) => boundedIssue(`${rejection.key}: ${rejection.reason}`)),
      );
    }
    const values = Object.fromEntries(
      parsed.extracted
        .map(({ key, value }) => [key, value] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ) as Partial<BrandTokens>;
    return {
      ok: true,
      value: {
        fileDigest,
        parserVersion: parsed.parserVersion,
        values,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "brand.md could not be parsed";
    return failure("invalid_document", 422, [boundedIssue(message)]);
  }
}
