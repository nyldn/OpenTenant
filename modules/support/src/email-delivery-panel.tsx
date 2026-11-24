import { TicketForm } from "./host-ui";
import type { listTicketEmailDeliveries } from "./delivery-store";

export function EmailDeliveryPanel({ deliveries, ticketId }: {
  deliveries: Awaited<ReturnType<typeof listTicketEmailDeliveries>>; ticketId: string;
}) {
  return <>
      {deliveries.length > 0 ? (
        <section aria-labelledby="email-delivery-heading" className="mt-8 min-w-0 rounded-lg border border-border p-4">
          <h2 id="email-delivery-heading" className="font-display text-base font-semibold">Email delivery</h2>
          <ul className="mt-3 space-y-4 text-sm">
            {deliveries.map(delivery => <li key={delivery.id} className="min-w-0 [overflow-wrap:anywhere]">
              <p>{delivery.event === "created" ? "Ticket confirmation" : "Reply notification"} · {delivery.status === "sending" ? "Sending" : delivery.status} · {delivery.attempts} attempts</p>
              {delivery.status === "failed" ? <p className="mt-1 text-muted-foreground">Email could not be delivered. Check the recipient's notification settings before retrying.</p> : null}
                <TicketForm action="/api/support/tickets" successPath={`/support/${ticketId}`} successMessage="Email queued for retry." className="mt-2">
                  <input type="hidden" name="op" value="retry_email" />
                  <input type="hidden" name="ticketId" value={ticketId} />
                  <input type="hidden" name="deliveryId" value={delivery.id} />
                  {delivery.status === "failed" ? <button type="submit" className="min-h-11 rounded-md border border-border px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Retry email</button> : null}
                </TicketForm>
            </li>)}
          </ul>
        </section>
      ) : null}

  </>;
}
