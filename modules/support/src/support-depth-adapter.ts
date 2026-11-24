import type {
  DeliveryChannel,
  DeliveryEvent,
  DeliverySafeErrorClass,
  DeliveryTransport,
} from "./support-depth-types";

export class SyntheticDeliveryTransport implements DeliveryTransport {
  readonly deliveries: Array<{
    tenantId: string;
    destinationRef: string;
    idempotencyKey: string;
    channel: DeliveryChannel;
    event: DeliveryEvent;
    ticketNumber: string;
  }> = [];
  private nextFailure: DeliverySafeErrorClass | null = null;
  private nextThrown: unknown = null;

  failNext(errorClass: DeliverySafeErrorClass): void {
    this.nextFailure = errorClass;
  }

  throwNext(error: unknown): void {
    this.nextThrown = error;
  }

  async deliver(input: (typeof this.deliveries)[number]) {
    this.deliveries.push({ ...input });
    const thrown = this.nextThrown;
    this.nextThrown = null;
    if (thrown !== null) throw thrown;
    const failure = this.nextFailure;
    this.nextFailure = null;
    return failure ? ({ ok: false, safeErrorClass: failure } as const) : ({ ok: true } as const);
  }
}
