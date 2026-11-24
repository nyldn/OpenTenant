import { createHash } from "node:crypto";
import type { EmailMessage, EmailResult, EmailTransport } from "./email";

export interface SmtpOptions {
  host: string;
  port: number;
  from: string;
  secure: boolean;
  requireTLS?: boolean;
  auth?: { user: string; pass: string };
}
// Narrow adapter-local view of Nodemailer. Provider results never escape.
interface Mailer {
  createTransport(options: Record<string, unknown>): {
    sendMail(
      message: Record<string, unknown>,
    ): Promise<{ accepted?: unknown[] }>;
  };
}
const ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const headerSafe = (value: string) =>
  !/[\r\n]/.test(value) && value.length <= 998;

export class SmtpEmailTransport implements EmailTransport {
  private client: ReturnType<Mailer["createTransport"]> | undefined;

  constructor(
    private readonly options: SmtpOptions,
    private readonly mailer?: Mailer,
  ) {
    if (
      !options.host ||
      !Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535 ||
      !ADDRESS.test(options.from)
    )
      throw new Error("Invalid SMTP configuration");
    if (
      !options.secure &&
      !options.requireTLS &&
      !["127.0.0.1", "localhost", "::1"].includes(options.host)
    )
      throw new Error("SMTP requires TLS outside loopback");
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    if (!ADDRESS.test(message.to) || !headerSafe(message.to))
      return { ok: false, reason: "destination_unavailable" };
    if (
      !headerSafe(message.subject) ||
      message.text.length + message.html.length > 2_000_000 ||
      !message.idempotencyKey ||
      message.idempotencyKey.length > 1024
    )
      return { ok: false, reason: "permanent" };
    try {
      if (!this.client) {
        // SMTP is optional at installation time. Missing Nodemailer fails closed.
        const mailer =
          this.mailer ??
          ((await import("nodemailer")).default as Mailer);
        this.client = mailer.createTransport({
          host: this.options.host,
          port: this.options.port,
          secure: this.options.secure,
          requireTLS: this.options.requireTLS ?? this.options.secure,
          ignoreTLS: !this.options.secure && !this.options.requireTLS,
          ...(this.options.auth ? { auth: this.options.auth } : {}),
          logger: false,
          debug: false,
          pool: false,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
          tls: { rejectUnauthorized: true },
        });
      }
      const hash = createHash("sha256")
        .update(message.idempotencyKey)
        .digest("hex");
      const result = await this.client.sendMail({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: `<${hash}@opentenant.invalid>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      return result.accepted?.length
        ? { ok: true }
        : { ok: false, reason: "destination_unavailable" };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "responseCode" in error
          ? Number(error.responseCode)
          : 0;
      return {
        ok: false,
        reason: code >= 500 && code <= 599 ? "permanent" : "transient",
      };
    }
  }
}
