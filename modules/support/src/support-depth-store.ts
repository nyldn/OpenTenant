import { now } from "./support-depth-policy";
import type {
  AttachmentRecord,
  CsatRecord,
  DeliveryAttempt,
  DeliveryPreference,
  SlaPolicy,
  SlaStateRecord,
  SupportAuthority,
  SupportDepthTicket,
  SupportEvidence,
} from "./support-depth-types";
import type { TicketStatus } from "./types";

export class InMemorySupportDepthStore {
  readonly tickets: SupportDepthTicket[] = [];
  readonly canonicalTicketVersions: Array<{
    tenantId: string;
    ticketId: string;
    ticketVersion: number;
  }> = [];
  readonly preferences: DeliveryPreference[] = [];
  readonly attempts: DeliveryAttempt[] = [];
  readonly attachments: AttachmentRecord[] = [];
  readonly slaPolicies: SlaPolicy[] = [];
  readonly slaStates: SlaStateRecord[] = [];
  readonly csat: CsatRecord[] = [];
  readonly evidence: SupportEvidence[] = [];
  private sequence = 0;

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(6, "0")}`;
  }

  seedTicket(ticket: SupportDepthTicket): void {
    if (
      !Number.isInteger(ticket.version) ||
      ticket.version < 1 ||
      !Number.isFinite(Date.parse(ticket.createdAt))
    ) {
      throw new Error("invalid ticket seed");
    }
    this.tickets.push({ ...ticket });
    this.canonicalTicketVersions.push({
      tenantId: ticket.tenantId,
      ticketId: ticket.ticketId,
      ticketVersion: ticket.version,
    });
    const stopped = ticket.status === "resolved" || ticket.status === "closed";
    const paused = ticket.status === "awaiting_reply";
    this.slaStates.push({
      tenantId: ticket.tenantId,
      ticketId: ticket.ticketId,
      state: stopped ? "stopped" : paused ? "paused" : "running",
      accumulatedPausedMinutes: 0,
      pausedAt: paused ? ticket.createdAt : null,
      lastTransitionAt: stopped ? (ticket.resolvedAt ?? ticket.createdAt) : ticket.createdAt,
    });
  }

  ticket(tenantId: string, ticketId: string): SupportDepthTicket | undefined {
    return this.tickets.find((ticket) => ticket.tenantId === tenantId && ticket.ticketId === ticketId);
  }

  hasCanonicalTicketVersion(
    tenantId: string,
    ticketId: string,
    ticketVersion: number,
  ): boolean {
    return this.canonicalTicketVersions.some(
      (candidate) =>
        candidate.tenantId === tenantId &&
        candidate.ticketId === ticketId &&
        candidate.ticketVersion === ticketVersion,
    );
  }

  setTicketStatus(
    tenantId: string,
    ticketId: string,
    status: TicketStatus,
    occurredAt: string,
  ): void {
    const ticket = this.ticket(tenantId, ticketId);
    if (!ticket) throw new Error("ticket not found");
    const state = this.slaStates.find(
      (candidate) => candidate.tenantId === tenantId && candidate.ticketId === ticketId,
    );
    const occurredAtMs = Date.parse(occurredAt);
    if (
      !state ||
      !Number.isFinite(occurredAtMs) ||
      occurredAtMs < Date.parse(state.lastTransitionAt)
    ) {
      throw new Error("invalid ticket transition");
    }
    if (state.state === "paused" && state.pausedAt) {
      state.accumulatedPausedMinutes +=
        (occurredAtMs - Date.parse(state.pausedAt)) / 60_000;
      state.pausedAt = null;
    }
    ticket.status = status;
    ticket.version += 1;
    this.canonicalTicketVersions.push({
      tenantId,
      ticketId,
      ticketVersion: ticket.version,
    });
    if (status === "resolved" || status === "closed") {
      ticket.resolvedAt = occurredAt;
      state.state = "stopped";
    } else if (status === "awaiting_reply") {
      state.state = "paused";
      state.pausedAt = occurredAt;
    } else {
      state.state = "running";
    }
    state.lastTransitionAt = occurredAt;
  }

  appendEvidence(
    authority: SupportAuthority,
    action: string,
    subjectRef: string,
    detail: SupportEvidence["detail"] = {},
  ): void {
    this.evidence.push({
      id: this.nextId("evidence"),
      tenantId: authority.tenantId,
      actorId: authority.actorId,
      action,
      subjectRef,
      detail,
      occurredAt: now(),
    });
  }
}
