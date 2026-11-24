import { describe, expect, it } from "vitest";
import { readBoundedBytes, readBoundedForm } from "./bounded-body";

function streamed(body: string): Request {
  const bytes = new TextEncoder().encode(body);
  return new Request("https://tenant.example.test/api/example", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
}

describe("bounded request bodies", () => {
  it("parses a form within the limit", async () => {
    const form = await readBoundedForm(new Request("https://tenant.example.test/api/example", {
      method: "POST",
      body: new URLSearchParams({ passcode: "1234" }),
    }));

    expect(form?.get("passcode")).toBe("1234");
  });

  it("rejects a declared length over the limit before reading", async () => {
    const req = new Request("https://tenant.example.test/api/example", {
      method: "POST",
      headers: { "content-length": "999999" },
      body: "x",
    });

    await expect(readBoundedBytes(req, 1024)).resolves.toEqual({ ok: false, reason: "too_large" });
  });

  it("stops a streamed body without a declared length at the limit", async () => {
    await expect(readBoundedBytes(streamed("x".repeat(2048)), 1024)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
    await expect(readBoundedForm(streamed(`passcode=${"x".repeat(2048)}`), 1024)).resolves.toBeNull();
  });

  it("returns null for a body without a form content type", async () => {
    const req = new Request("https://tenant.example.test/api/example", { method: "POST", body: "a=b" });
    req.headers.delete("content-type");

    await expect(readBoundedForm(req)).resolves.toBeNull();
  });
});
