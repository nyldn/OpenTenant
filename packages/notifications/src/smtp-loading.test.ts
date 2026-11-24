import { afterEach, expect, it, vi } from "vitest";

const options = { host: "127.0.0.1", port: 2526, from: "sender@example.test", secure: false };
const message = { to: "recipient@example.test", subject: "Synthetic", text: "Text", html: "<p>Text</p>", idempotencyKey: "synthetic/1" };

afterEach(() => { vi.doUnmock("nodemailer"); vi.resetModules(); });

it("loads optional Nodemailer only on send and fails closed if it is missing", async () => {
  const load = vi.fn(() => { throw new Error("optional dependency missing"); });
  vi.doMock("nodemailer", load);
  const { SmtpEmailTransport } = await import("./smtp");
  const transport = new SmtpEmailTransport(options);
  expect(load).not.toHaveBeenCalled();
  expect(await transport.send(message)).toEqual({ ok: false, reason: "transient" });
  expect(load).toHaveBeenCalledOnce();
});

it("never loads the optional dependency when a transport is injected", async () => {
  const load = vi.fn(() => { throw new Error("must stay lazy"); });
  vi.doMock("nodemailer", load);
  const { SmtpEmailTransport } = await import("./smtp");
  const transport = new SmtpEmailTransport(options, { createTransport: () => ({ sendMail: async () => ({ accepted: [message.to] }) }) });
  expect(await transport.send(message)).toEqual({ ok: true });
  expect(load).not.toHaveBeenCalled();
});
