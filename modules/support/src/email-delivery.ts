import {
  renderSupportEmail,
  SmtpEmailTransport,
} from "@opentenant/notifications";
import type { EmailTransport, SmtpOptions } from "@opentenant/notifications";
import type { DeliveryTransport } from "./support-depth-types";
import type { InMemorySupportDepthStore } from "./support-depth-store";
import { SupportDepthService } from "./support-depth-service";

export interface SupportEmailDirectory {
  /** Resolve only within the authenticated tenant; never accept an address from a delivery request. */
  resolveEmail(
    tenantId: string,
    destinationRef: string,
  ): Promise<{ tenantId: string; address: string } | null>;
}

export class SupportEmailDeliveryTransport implements DeliveryTransport {
  constructor(
    private readonly email: EmailTransport,
    private readonly directory: SupportEmailDirectory,
    private readonly inApp?: DeliveryTransport,
  ) {}

  async deliver(
    input: Parameters<DeliveryTransport["deliver"]>[0],
  ): ReturnType<DeliveryTransport["deliver"]> {
    try {
      if (input.channel === "in_app")
        return this.inApp
          ? await this.inApp.deliver(input)
          : { ok: false, safeErrorClass: "destination_unavailable" };
      const destination = await this.directory.resolveEmail(
        input.tenantId,
        input.destinationRef,
      );
      if (!destination || destination.tenantId !== input.tenantId)
        return { ok: false, safeErrorClass: "destination_unavailable" };
      const content = await renderSupportEmail(input);
      const result = await this.email.send({
        to: destination.address,
        subject: `Support ticket ${input.ticketNumber}: ${input.event}`,
        ...content,
        idempotencyKey: input.idempotencyKey,
      });
      return result.ok
        ? { ok: true }
        : { ok: false, safeErrorClass: result.reason };
    } catch {
      return { ok: false, safeErrorClass: "transient" };
    }
  }
}

export interface SupportEmailOptions {
  directory: SupportEmailDirectory;
  email: EmailTransport | SmtpOptions;
  inApp?: DeliveryTransport;
}

export function createSupportEmailTransport(options: SupportEmailOptions): SupportEmailDeliveryTransport {
  const email = "send" in options.email ? options.email : new SmtpEmailTransport(options.email);
  return new SupportEmailDeliveryTransport(email, options.directory, options.inApp);
}

/** Legacy in-memory depth fixture. Ticket HTTP delivery uses the durable outbox queue. */
export function createSupportDeliveryService(
  store: InMemorySupportDepthStore,
  options: SupportEmailOptions,
): SupportDepthService {
  return new SupportDepthService(store, createSupportEmailTransport(options));
}
