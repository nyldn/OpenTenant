export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Caller-owned deduplication key. SMTP cannot guarantee exactly-once delivery. */
  idempotencyKey: string;
}
export type EmailResult =
  | { ok: true }
  | {
      ok: false;
      reason: "transient" | "permanent" | "destination_unavailable";
    };
export interface EmailTransport {
  send(message: EmailMessage): Promise<EmailResult>;
}
