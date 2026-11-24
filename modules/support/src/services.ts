import { createSupportEmailDeliveryTask } from "./delivery-worker";
import { getTicketByNumber, listTickets, listTicketSummaries } from "./ticket-store";
import { claimPendingOutboxEvents, latestOutboxEventId, markOutboxDelivered, markOutboxFailed } from "./outbox";
/** Public port for an installation's operator helpdesk and capability broker. */
export interface HelpdeskSource {
  createEmailDeliveryTask: typeof createSupportEmailDeliveryTask;
  getTicketByNumber: typeof getTicketByNumber;
  listTickets: typeof listTickets;
  listTicketSummaries: typeof listTicketSummaries;
  claimPendingOutboxEvents: typeof claimPendingOutboxEvents;
  latestOutboxEventId: typeof latestOutboxEventId;
  markOutboxDelivered: typeof markOutboxDelivered;
  markOutboxFailed: typeof markOutboxFailed;
}
export const helpdeskSource: HelpdeskSource = { createEmailDeliveryTask: createSupportEmailDeliveryTask, getTicketByNumber, listTickets, listTicketSummaries,
  claimPendingOutboxEvents, latestOutboxEventId, markOutboxDelivered, markOutboxFailed };
