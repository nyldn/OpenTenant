import type { TicketPriority, TicketStatus } from "./types";

export type DeliveryChannel = "in_app" | "email";
export type DeliveryEvent = "created" | "reply" | "assigned" | "resolved" | "csat_request";
export type DeliveryStatus = "delivered" | "failed";
export type DeliverySafeErrorClass = "transient" | "permanent" | "destination_unavailable";

export interface SupportAuthority {
  tenantId: string;
  actorId: string;
  kind: "requester" | "tenant_admin" | "installation_owner" | "managed_support";
  permissions: ReadonlyArray<string>;
  /** Already-resolved, short-lived managed-support context from the platform boundary. */
  supportSession?: {
    id: string;
    tenantId: string;
    operatorId: string;
    expiresAt: string;
  };
}

export interface SupportDepthTicket {
  tenantId: string;
  ticketId: string;
  ticketNumber: string;
  requesterId: string;
  status: TicketStatus;
  priority: TicketPriority;
  /** Canonical monotonic version from support.tickets. */
  version: number;
  createdAt: string;
  firstRespondedAt?: string;
  resolvedAt?: string;
}

export interface DeliveryPreference {
  tenantId: string;
  subjectId: string;
  channel: DeliveryChannel;
  enabled: boolean;
  /** Opaque vault/directory reference; never an address. */
  destinationRef: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  id: string;
  tenantId: string;
  ticketId: string;
  ticketVersion: number;
  channel: DeliveryChannel;
  event: DeliveryEvent;
  destinationRef: string;
  idempotencyKey: string;
  status: DeliveryStatus;
  safeErrorClass: DeliverySafeErrorClass | null;
  retryOf: string | null;
  rootAttemptId: string;
  attemptNumber: number;
  createdAt: string;
}

export interface AttachmentRecord {
  id: string;
  tenantId: string;
  ticketId: string;
  uploadedBy: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  /** Opaque tenant-scoped object-store reference; never a URL or object bytes. */
  objectRef: string;
  createdAt: string;
}

export type AttachmentMetadata = Omit<AttachmentRecord, "objectRef">;

export interface SlaPolicy {
  tenantId: string;
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

export interface SlaStateRecord {
  tenantId: string;
  ticketId: string;
  state: "running" | "paused" | "stopped";
  accumulatedPausedMinutes: number;
  pausedAt: string | null;
  lastTransitionAt: string;
}

export interface CsatRecord {
  tenantId: string;
  ticketId: string;
  requesterId: string;
  rating: number;
  comment: string | null;
  submittedAt: string;
}

export interface SupportEvidence {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  subjectRef: string;
  detail: Readonly<Record<string, string | number | boolean | null>>;
  occurredAt: string;
}

export interface DeliveryTransport {
  deliver(input: {
    tenantId: string;
    destinationRef: string;
    idempotencyKey: string;
    channel: DeliveryChannel;
    event: DeliveryEvent;
    ticketNumber: string;
  }): Promise<{ ok: true } | { ok: false; safeErrorClass: DeliverySafeErrorClass }>;
}
