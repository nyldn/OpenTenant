import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { SmtpEmailTransport } from "./smtp";
import { renderSupportEmail } from "./support-template";

it("sends SMTP and reads both rendered bodies from Mailpit HTTP", async (context) => {
  const api = process.env.MAILPIT_HTTP_URL ?? "http://127.0.0.1:18026";
  const url = new URL(api);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password
  )
    throw new Error("Mailpit proof requires local HTTP");
  let running = false;
  try {
    running = (
      await fetch(`${api}/api/v1/info`, { signal: AbortSignal.timeout(1500) })
    ).ok;
  } catch {
    /* explicit availability check */
  }
  if (!running) {
    if (process.env.MAILPIT_REQUIRED === "1")
      throw new Error(
        "Mailpit is required but unavailable; start the documented local service",
      );
    context.skip(
      "Mailpit is not running; start docker compose up -d mailpit, or set MAILPIT_REQUIRED=1 in CI",
    );
    return;
  }
  const subject = `SMTP proof ${randomUUID()}`;
  const transport = new SmtpEmailTransport({
    host: "127.0.0.1",
    port: Number(process.env.MAILPIT_SMTP_PORT ?? 11026),
    secure: false,
    from: "support@example.test",
  });
  expect(
    await transport.send({
      to: "recipient@example.test",
      subject,
      ...(await renderSupportEmail({ ticketNumber: "SUP-42", event: "reply" })),
      idempotencyKey: subject,
    }),
  ).toEqual({ ok: true });
  const response = await fetch(`${api}/api/v1/messages`, {
    signal: AbortSignal.timeout(3000),
  });
  const list = (await response.json()) as {
    messages: Array<{ ID: string; Subject: string }>;
  };
  const record = list.messages.find((message) => message.Subject === subject);
  expect(record).toBeDefined();
  const detail = (await (
    await fetch(`${api}/api/v1/message/${record!.ID}`, {
      signal: AbortSignal.timeout(3000),
    })
  ).json()) as { Subject: string; To: Array<{ Address: string }>; HTML: string; Text: string };
  expect(detail.Subject).toBe(subject);
  expect(detail.To.map(recipient => recipient.Address)).toEqual(["recipient@example.test"]);
  const raw = await (await fetch(`${api}/api/v1/message/${record!.ID}/raw`, { signal: AbortSignal.timeout(3000) })).text();
  const headers = raw.split(/\r?\n\r?\n/, 1)[0]!;
  expect(headers).not.toMatch(/^(?:authorization|cookie|set-cookie|x-api-key):/im);
  expect(detail.HTML).toContain("SUP-42");
  expect(detail.Text).toContain("SUP-42");
  expect(detail.Text).toContain("reply");
});
