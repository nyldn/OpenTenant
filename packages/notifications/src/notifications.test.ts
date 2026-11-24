import { describe, expect, it, vi } from "vitest";
import { SmtpEmailTransport } from "./smtp";
import { renderSupportEmail } from "./support-template";

const message = {
  to: "recipient@example.test",
  subject: "Ticket SUP-1",
  html: "<p>Update</p>",
  text: "Update",
  idempotencyKey: "tenant/ticket/1",
};
const options = {
  host: "127.0.0.1",
  port: 2526,
  from: "support@example.test",
  secure: false,
};

describe("SMTP email boundary", () => {
  it("sends both formats and a stable message id without provider objects escaping", async () => {
    const sendMail = vi
      .fn()
      .mockResolvedValue({
        accepted: [message.to],
        response: "provider-secret",
      });
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    const transport = new SmtpEmailTransport(options, { createTransport });
    expect(await transport.send(message)).toEqual({ ok: true });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ logger: false, debug: false, ignoreTLS: true }),
    );
    const sent = sendMail.mock.calls[0]![0];
    expect(sent).toMatchObject({
      to: message.to,
      text: "Update",
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(sent.messageId).not.toContain(message.idempotencyKey);
    await transport.send(message);
    expect(sendMail.mock.calls[1]![0].messageId).toBe(sent.messageId);
  });
  it.each([450, 550])("normalizes SMTP status %i", async (responseCode) => {
    const transport = new SmtpEmailTransport(options, {
      createTransport: () => ({
        sendMail: async () => {
          throw { responseCode, message: "secret" };
        },
      }),
    });
    expect(await transport.send(message)).toEqual({
      ok: false,
      reason: responseCode === 450 ? "transient" : "permanent",
    });
  });
  it("rejects headers and recipient lists before SMTP", async () => {
    const sendMail = vi.fn();
    const transport = new SmtpEmailTransport(options, {
      createTransport: () => ({ sendMail }),
    });
    for (const to of [
      "a@example.test,b@example.test",
      "a@example.test\r\nBcc: b@example.test",
    ]) {
      expect(await transport.send({ ...message, to })).toEqual({
        ok: false,
        reason: "destination_unavailable",
      });
    }
    expect(await transport.send({ ...message, subject: "a\r\nb" })).toEqual({
      ok: false,
      reason: "permanent",
    });
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("fails closed when SMTP refuses the recipient", async () => {
    const transport = new SmtpEmailTransport(options, {
      createTransport: () => ({ sendMail: async () => ({ accepted: [] }) }),
    });
    expect(await transport.send(message)).toEqual({
      ok: false,
      reason: "destination_unavailable",
    });
  });
  it("requires TLS for non-loopback SMTP", () => {
    expect(
      () => new SmtpEmailTransport({ ...options, host: "smtp.example.test" }),
    ).toThrow("TLS");
  });
  it("renders escaped support content as HTML and plain text", async () => {
    const rendered = await renderSupportEmail({
      ticketNumber: "<script>bad</script>",
      event: "reply",
    });
    expect(rendered.html).not.toContain("<script>bad</script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.text).toContain("reply");
    expect(rendered.text).toContain("bad");
  });
});

it("sends multipart email through the installed Nodemailer SMTP client on loopback", async () => {
  const { createServer } = await import("node:net");
  let received = "";
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 localhost SMTP test\r\n");
    let buffer = "";
    let data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (data && line !== ".") received += line + "\r\n";
        else if (data) {
          data = false;
          socket.write("250 accepted\r\n");
        } else if (line.startsWith("EHLO")) socket.write("250 localhost\r\n");
        else if (line === "DATA") {
          data = true;
          socket.write("354 end with dot\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing test SMTP port");
    const transport = new SmtpEmailTransport({
      ...options,
      port: address.port,
    });
    expect(await transport.send(message)).toEqual({ ok: true });
    expect(received).toContain("Content-Type: multipart/alternative");
    expect(received).toContain("Content-Type: text/plain");
    expect(received).toContain("Content-Type: text/html");
    expect(received).toContain("recipient@example.test");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 30_000);
