"use client";

import { navigateBrowser } from "@opentenant/platform-core/runtime-globals";

import { useState } from "react";
import { FormField, FormStatus, Input, SharedForm, type FormOutcome } from "@opentenant/design-system";

export const BRAND_DOCUMENT_MAX_BYTES = 262_144;
export const BRAND_DOCUMENT_ACCEPT = ".md,text/markdown,text/plain";
export const BRAND_DOCUMENT_UPLOAD_ENDPOINT = "/api/admin/brand-proposals";

export type UploadMessage = {
  readonly tone: "error" | "progress";
  readonly text: string;
  readonly issues: readonly string[];
};

const MAX_ERROR_ISSUES = 64;
const MAX_ERROR_ISSUE_CHARACTERS = 512;

export function validateBrandDocumentFile(file: File | null): string | null {
  if (!file) return "Choose one brand.md file to upload.";
  if (!/\.md$/iu.test(file.name)) return "The document must use the .md extension.";
  if (file.size > BRAND_DOCUMENT_MAX_BYTES) return "The document must be 256 KiB or smaller.";
  const mediaType = file.type.toLowerCase();
  if (mediaType !== "text/markdown" && mediaType !== "text/plain") {
    return "The document must be text/markdown or text/plain.";
  }
  return null;
}

export function brandDocumentUploadEndpoint(
  form: Pick<HTMLFormElement, "getAttribute">,
): string {
  return form.getAttribute("action") ?? BRAND_DOCUMENT_UPLOAD_ENDPOINT;
}

function serverErrorMessage(code: unknown): string {
  switch (code) {
    case "upload_too_large":
      return "The upload is too large. Choose a brand.md file no larger than 256 KiB.";
    case "unsupported_media_type":
      return "That file type is not accepted. Choose Markdown or plain text.";
    case "invalid_encoding":
      return "The file is not valid UTF-8. Save the document as UTF-8 and try again.";
    case "invalid_document":
      return "The document could not be accepted. Check its recognised brand fields and try again.";
    case "upload_conflict":
      return "A draft changed while this upload was being saved. Reload the page and try again.";
    case "upload_failed":
      return "The upload could not be saved. Nothing was applied to the active brand.";
    default:
      return "The upload could not be accepted. Nothing was applied to the active brand.";
  }
}

export function brandDocumentUploadFeedback(body: unknown): UploadMessage {
  const record = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const code = record.code;
  const issues = code === "invalid_document" && Array.isArray(record.issues)
    ? record.issues
      .filter((issue): issue is string => typeof issue === "string" && issue.length > 0)
      .slice(0, MAX_ERROR_ISSUES)
      .map((issue) => [...issue].slice(0, MAX_ERROR_ISSUE_CHARACTERS).join(""))
    : [];
  return { tone: "error", text: serverErrorMessage(code), issues };
}

async function readErrorFeedback(response: Response): Promise<UploadMessage> {
  try {
    const body: unknown = await response.json();
    return brandDocumentUploadFeedback(body);
  } catch {
    // The route's plain-text denial is intentionally not shown to the operator.
  }
  return brandDocumentUploadFeedback(undefined);
}

export function BrandDocumentUploadMessage({ message }: { message: UploadMessage }) {
  return <FormStatus status={message.tone === "error" ? "error" : "success"}>
    <p>{message.text}</p>
    {message.issues.length > 0 && <ul>{message.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
  </FormStatus>;
}

export default function BrandDocumentUploadForm({ tenantId }: { tenantId: string }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  async function submit(data: FormData): Promise<FormOutcome> {
    const value = data.get("brandDocument");
    const file = value instanceof File && value.name ? value : null;
    const error = validateBrandDocumentFile(file);
    if (error) return { status: "error", message: error, fieldErrors: { brandDocument: error } };
    try {
      const response = await fetch(BRAND_DOCUMENT_UPLOAD_ENDPOINT, { method: "POST", body: data, credentials: "same-origin" });
      if (response.ok) {
        navigateBrowser(response.url);
        return { status: "success", message: "Draft uploaded. Review it before applying." };
      }
      const feedback = await readErrorFeedback(response);
      return { status: "error", message: [feedback.text, ...feedback.issues].join(" ") };
    } catch {
      return { status: "error", message: "The upload could not reach the server. Check the connection and try again." };
    }
  }
  const nativeAction = { action: BRAND_DOCUMENT_UPLOAD_ENDPOINT };
  return <SharedForm {...nativeAction} id="brand-upload" method="post" encType="multipart/form-data" onSubmit={submit} submitLabel="Upload draft" pendingLabel="Uploading document…" className="mt-4 space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
    <input type="hidden" name="tenantId" value={tenantId} />
    <input type="hidden" name="action" value="upload" />
    <h2 className="font-display text-lg font-semibold">Upload brand.md</h2>
    <p className="text-sm text-muted-foreground">Upload one deterministic Markdown document. Nothing changes in the active brand until a permitted operator reviews and applies it.</p>
    <FormField name="brandDocument" label="Brand document" help="One .md file, 256 KiB maximum. Accepted media types: text/markdown or text/plain. The server requires strict UTF-8 and caps the total request at 278,528 bytes.">{control => <Input {...control} type="file" accept={BRAND_DOCUMENT_ACCEPT} required onChange={event => setSelectedName(event.currentTarget.files?.[0]?.name ?? null)} />}</FormField>
    {selectedName && <p className="break-all text-sm">Selected: {selectedName}</p>}
  </SharedForm>;
}
