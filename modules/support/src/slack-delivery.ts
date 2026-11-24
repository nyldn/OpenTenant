import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  outboxIdempotencyKey,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "./types";

export interface SlackTicketNotification {
  tenantId: string;
  tenantLabel: string;
  ticketNumber: string;
  ticketVersion: number;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  occurredAt: string;
  /** Server-generated canonical ticket URL, never caller-supplied Slack markup. */
  deepLink: string;
}

export interface SlackMessage {
  text: string;
  blocks: ReadonlyArray<Readonly<Record<string, unknown>>>;
  unfurl_links: false;
  unfurl_media: false;
}

function escapeSlackText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function boundedText(value: string, label: string, maximum: number): string {
  if (value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`invalid Slack ${label}`);
  }
  return escapeSlackText(value);
}

function safeDeepLink(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid Slack ticket deep link");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    /[<>|]/u.test(value) ||
    value.length > 2_048
  ) {
    throw new Error("invalid Slack ticket deep link");
  }
  return url.toString();
}

/**
 * Reconstructs the outbound payload from the approved metadata allowlist.
 * Runtime extra properties are deliberately ignored.
 */
export function projectSlackTicketMessage(input: SlackTicketNotification): SlackMessage {
  const tenantLabel = boundedText(input.tenantLabel, "tenant label", 120);
  const ticketNumber = boundedText(input.ticketNumber, "ticket reference", 64);
  const category = boundedText(input.category, "ticket category", 40);
  const priority = boundedText(input.priority, "ticket priority", 16);
  const status = boundedText(input.status, "ticket status", 24);
  const link = safeDeepLink(input.deepLink);
  if (!(TICKET_CATEGORIES as ReadonlyArray<string>).includes(input.category)) {
    throw new Error("invalid Slack ticket category");
  }
  if (!(TICKET_PRIORITIES as ReadonlyArray<string>).includes(input.priority)) {
    throw new Error("invalid Slack ticket priority");
  }
  if (!(TICKET_STATUSES as ReadonlyArray<string>).includes(input.status)) {
    throw new Error("invalid Slack ticket status");
  }
  if (!Number.isInteger(input.ticketVersion) || input.ticketVersion < 1) {
    throw new Error("invalid Slack ticket version");
  }
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    throw new Error("invalid Slack occurrence time");
  }
  const fallback = `${tenantLabel}: ticket ${ticketNumber} is ${status} (${priority})`;
  return {
    text: fallback,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Support ticket ${ticketNumber}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Tenant*\n${tenantLabel}` },
          { type: "mrkdwn", text: `*Category*\n${category}` },
          { type: "mrkdwn", text: `*Priority*\n${priority}` },
          { type: "mrkdwn", text: `*Status*\n${status}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `<${link}|Open ticket ${ticketNumber}>` },
      },
    ],
    unfurl_links: false,
    unfurl_media: false,
  };
}

export type SlackSafeErrorClass =
  | "transient"
  | "permanent"
  | "credential_unavailable"
  | "invalid_message";

export class SlackDeliveryError extends Error {
  constructor(
    readonly safeClass: SlackSafeErrorClass,
    message: string,
  ) {
    super(message);
    this.name = "SlackDeliveryError";
  }
}

export interface SlackCredentialBoundary {
  assertTenant(connectionId: string, tenantId: string): Promise<void>;
  deliver(
    connectionId: string,
    tenantId: string,
    transport: SlackTransport,
    message: SlackMessage,
    idempotencyKey: string,
  ): Promise<void>;
}

export interface SlackCredentialCipher {
  encrypt(plaintext: string, aad: string): string;
  decrypt(ciphertext: string, aad: string): string;
}

/**
 * Local encrypted credential boundary. Production composition injects the
 * repository CredentialCipher; synthetic tests may inject a deterministic
 * cipher. AAD prevents swapping ciphertext across a tenant or connection.
 */
export class EncryptedSlackCredentialBoundary implements SlackCredentialBoundary {
  readonly #records = new Map<string, Map<string, string>>();

  constructor(private readonly cipher: SlackCredentialCipher) {}

  store(connectionId: string, tenantId: string, webhook: string): void {
    const tenantRecords = this.#records.get(tenantId) ?? new Map<string, string>();
    tenantRecords.set(
      connectionId,
      this.cipher.encrypt(webhook, this.#aad(connectionId, tenantId)),
    );
    this.#records.set(tenantId, tenantRecords);
  }

  async assertTenant(connectionId: string, tenantId: string): Promise<void> {
    if (!this.#records.get(tenantId)?.has(connectionId)) {
      throw new SlackDeliveryError("credential_unavailable", "Slack credential unavailable");
    }
  }

  async deliver(
    connectionId: string,
    tenantId: string,
    transport: SlackTransport,
    message: SlackMessage,
    idempotencyKey: string,
  ): Promise<void> {
    await this.assertTenant(connectionId, tenantId);
    const encryptedWebhook = this.#records.get(tenantId)!.get(connectionId)!;
    let webhook: string;
    try {
      webhook = this.cipher.decrypt(
        encryptedWebhook,
        this.#aad(connectionId, tenantId),
      );
    } catch {
      throw new SlackDeliveryError(
        "credential_unavailable",
        "Slack credential unavailable",
      );
    }
    await transport.post(webhook, message, idempotencyKey);
  }

  #aad(connectionId: string, tenantId: string): string {
    return `slack-webhook:${JSON.stringify([tenantId, connectionId])}`;
  }
}

export interface SlackTransport {
  post(webhook: string, message: SlackMessage, idempotencyKey: string): Promise<void>;
}

export interface SyntheticSlackDelivery {
  message: SlackMessage;
  idempotencyKey: string;
}

/** A no-network transport used to prove payload and failure behavior locally. */
export class InMemorySlackTransport implements SlackTransport {
  readonly deliveries: SyntheticSlackDelivery[] = [];
  readonly #outcomes: Array<Error | undefined>;

  constructor(outcomes: Array<Error | undefined> = []) {
    this.#outcomes = [...outcomes];
  }

  async post(_webhook: string, message: SlackMessage, idempotencyKey: string): Promise<void> {
    const outcome = this.#outcomes.shift();
    if (outcome) throw outcome;
    this.deliveries.push({ message: structuredClone(message), idempotencyKey });
  }
}

interface QueuedDelivery {
  connectionId: string;
  tenantId: string;
  idempotencyKey: string;
  message: SlackMessage;
  attempts: number;
}

export interface SlackDeliveryHealth {
  lastSuccessAt: Date | null;
  lastSafeErrorClass: SlackSafeErrorClass | null;
  queuedAttempts: number;
  permanentFailures: number;
}

export type SlackProcessResult = {
  status: "empty" | "delivered" | "retry_scheduled" | "dead";
};

export class LocalSlackDeliveryAdapter {
  readonly #queue: QueuedDelivery[] = [];
  readonly #knownKeys = new Set<string>();
  readonly #deadKeys = new Set<string>();
  readonly #maxAttempts: number;
  #lastSuccessAt: Date | null = null;
  #lastSafeErrorClass: SlackSafeErrorClass | null = null;

  constructor(
    private readonly credentials: SlackCredentialBoundary,
    private readonly transport: SlackTransport,
    options: { maxAttempts?: number } = {},
  ) {
    this.#maxAttempts = Math.max(1, Math.min(10, Math.trunc(options.maxAttempts ?? 3)));
  }

  async enqueue(input: {
    connectionId: string;
    tenantId: string;
    idempotencyKey: string;
    notification: SlackTicketNotification;
  }): Promise<"queued" | "duplicate"> {
    if (input.notification.tenantId !== input.tenantId) {
      throw new Error("Slack notification tenant mismatch");
    }
    if (outboxIdempotencyKey(input.notification) !== input.idempotencyKey) {
      throw new Error("Slack delivery idempotency key mismatch");
    }
    await this.credentials.assertTenant(input.connectionId, input.tenantId);
    if (this.#knownKeys.has(input.idempotencyKey)) return "duplicate";
    const message = projectSlackTicketMessage({ ...input.notification });
    this.#knownKeys.add(input.idempotencyKey);
    this.#queue.push({
      connectionId: input.connectionId,
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      message,
      attempts: 0,
    });
    return "queued";
  }

  async enqueueManualTest(
    connectionId: string,
    tenantId: string,
    tenantLabel: string,
  ): Promise<"queued" | "duplicate"> {
    await this.credentials.assertTenant(connectionId, tenantId);
    const label = boundedText(tenantLabel, "tenant label", 120);
    const idempotencyKey = `manual-test/${tenantId}/${crypto.randomUUID()}`;
    this.#knownKeys.add(idempotencyKey);
    this.#queue.push({
      connectionId,
      tenantId,
      idempotencyKey,
      attempts: 0,
      message: {
        text: `MANUAL TEST — synthetic Slack delivery for ${label}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*MANUAL TEST* — synthetic Slack delivery for ${label}. No ticket data is included.`,
            },
          },
        ],
        unfurl_links: false,
        unfurl_media: false,
      },
    });
    return "queued";
  }

  async processNext(): Promise<SlackProcessResult> {
    const delivery = this.#queue.shift();
    if (!delivery) return { status: "empty" };
    delivery.attempts += 1;
    try {
      await this.credentials.deliver(
        delivery.connectionId,
        delivery.tenantId,
        this.transport,
        delivery.message,
        delivery.idempotencyKey,
      );
      this.#lastSuccessAt = new Date();
      this.#lastSafeErrorClass = null;
      return { status: "delivered" };
    } catch (error) {
      const safeClass =
        error instanceof SlackDeliveryError ? error.safeClass : "transient";
      this.#lastSafeErrorClass = safeClass;
      const retryable = safeClass === "transient";
      if (retryable && delivery.attempts < this.#maxAttempts) {
        this.#queue.push(delivery);
        return { status: "retry_scheduled" };
      }
      this.#deadKeys.add(delivery.idempotencyKey);
      return { status: "dead" };
    }
  }

  health(): SlackDeliveryHealth {
    return {
      lastSuccessAt: this.#lastSuccessAt ? new Date(this.#lastSuccessAt) : null,
      lastSafeErrorClass: this.#lastSafeErrorClass,
      queuedAttempts: this.#queue.length,
      permanentFailures: this.#deadKeys.size,
    };
  }
}
