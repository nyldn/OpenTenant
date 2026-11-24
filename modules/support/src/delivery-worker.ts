import type { DeliveryTransport } from "./support-depth-types";
import { PgSupportDeliveryStore, type SupportDeliveryTransaction } from "./delivery-store";
import { createSupportEmailTransport, type SupportEmailOptions } from "./email-delivery";

/**
 * Integrator worker task: call for each active tenant on every worker tick.
 * Each claim/receipt commits independently of SMTP. Restarting reconstructs all
 * state from PostgreSQL, including expired leases and scheduled retries.
 *
 * SMTP is at-least-once. A crash after SMTP acceptance and before the receipt
 * can resend with the SAME idempotency key / SMTP Message-ID. SMTP servers may
 * deduplicate that ID but need not. Never mint a fresh key for a retry.
 */
export function createSupportEmailDeliveryTask(options: SupportEmailOptions & {
  withTenantDb: SupportDeliveryTransaction;
}) {
  return supportEmailDeliveryTask(new PgSupportDeliveryStore(options.withTenantDb), createSupportEmailTransport(options));
}

export function supportEmailDeliveryTask(store: Pick<PgSupportDeliveryStore, "claim" | "ready" | "settle">, transport: DeliveryTransport) {
  return async (tenantId: string, limit = 25): Promise<number> => {
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 25;
    let processed = 0;
    while (processed < bounded) {
      const delivery = await store.claim(tenantId);
      if (!delivery) break;
      // Defend even against a misbound store or directory implementation.
      if (delivery.tenant_id !== tenantId) throw new Error("Support delivery tenant mismatch");
      let result: Awaited<ReturnType<DeliveryTransport["deliver"]>>;
      try {
        result = await store.ready(delivery)
          ? await transport.deliver({
            tenantId, destinationRef: delivery.destination_ref, idempotencyKey: delivery.idempotency_key,
            ticketNumber: delivery.ticket_number, event: delivery.event, channel: "email",
          })
          : { ok: false, safeErrorClass: "destination_unavailable" };
      } catch {
        result = { ok: false, safeErrorClass: "transient" };
      }
      await store.settle(delivery, result);
      processed++;
    }
    return processed;
  };
}
