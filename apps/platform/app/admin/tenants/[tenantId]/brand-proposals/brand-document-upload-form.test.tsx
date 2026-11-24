import { expect, it, vi } from "vitest";
// Keep the workspace peer React identical to the host renderer in this test.
vi.mock("../../../../../../../packages/design-system/node_modules/react", async () => vi.importActual("react"));
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
Object.assign(globalThis, { React });
import BrandDocumentUploadForm, {
  BrandDocumentUploadMessage,
  BRAND_DOCUMENT_ACCEPT,
  BRAND_DOCUMENT_MAX_BYTES,
  brandDocumentUploadFeedback,
  brandDocumentUploadEndpoint,
  validateBrandDocumentFile,
} from "./brand-document-upload-form";

it("validates the accepted Markdown file boundary before sending a request", () => {
  expect(validateBrandDocumentFile(new File(["# Brand"], "brand.md", { type: "text/markdown" }))).toBeNull();
  expect(validateBrandDocumentFile(new File(["# Brand"], "brand.txt", { type: "text/plain" }))).toContain(".md extension");
  expect(validateBrandDocumentFile(new File([new Uint8Array(BRAND_DOCUMENT_MAX_BYTES + 1)], "brand.md", { type: "text/markdown" }))).toContain("256 KiB");
  expect(validateBrandDocumentFile(new File(["# Brand"], "brand.md", { type: "text/html" }))).toContain("text/markdown");
});

it("renders an accessible multipart form with the exact server field contract", () => {
  const markup = renderToStaticMarkup(<BrandDocumentUploadForm tenantId="ten_example" />);
  expect(markup).toContain('encType="multipart/form-data"');
  expect(markup).toContain('name="tenantId"');
  expect(markup).toContain('name="action"');
  expect(markup).toContain('value="upload"');
  expect(markup).toContain('name="brandDocument"');
  expect(markup).toContain(`accept="${BRAND_DOCUMENT_ACCEPT}"`);
  expect(markup).toContain("256 KiB");
  expect(markup).toContain("278,528 bytes");
  expect(markup).toContain("strict UTF-8");
});

it("resolves the API endpoint from the form attribute, not the shadowing action field", () => {
  const endpoint = "/api/admin/brand-proposals";
  const form = {
    action: { name: "action", value: "upload" },
    getAttribute(name: string) {
      return name === "action" ? endpoint : null;
    },
  } as unknown as HTMLFormElement;

  expect(brandDocumentUploadEndpoint(form)).toBe(endpoint);
});

it("bounds parser feedback, renders it as escaped text, and ignores details for other errors", () => {
  const feedback = brandDocumentUploadFeedback({
    code: "invalid_document",
    issues: [
      "displayName: duplicate key",
      "colorPrimary: <script>alert('unsafe')</script>",
      "x".repeat(600),
      42,
    ],
  });

  expect(feedback.issues).toHaveLength(3);
  expect([...feedback.issues[2]!]).toHaveLength(512);
  const markup = renderToStaticMarkup(<BrandDocumentUploadMessage message={feedback} />);
  expect(markup).toContain("displayName: duplicate key");
  expect(markup).toContain("colorPrimary: &lt;script&gt;alert(&#x27;unsafe&#x27;)&lt;/script&gt;");
  expect(markup).not.toContain("<script>");

  expect(brandDocumentUploadFeedback({
    code: "upload_conflict",
    issues: ["should not be shown"],
  })).toMatchObject({
    text: expect.stringContaining("draft changed"),
    issues: [],
  });
  expect(brandDocumentUploadFeedback({
    code: "invalid_document",
    issues: ["coBrandingRequired: must be true or false"],
  }).issues).toEqual(["coBrandingRequired: must be true or false"]);
});
