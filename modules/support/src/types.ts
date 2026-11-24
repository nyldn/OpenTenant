import type { AuditActor } from "@opentenant/security";

export type TicketCategory =
  | "bug_report"
  | "feature_request"
  | "how_to"
  | "account_issue"
  | "billing"
  | "other";
export type TicketStatus = "open" | "in_progress" | "awaiting_reply" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type MessageType = "reply" | "internal_note" | "ai_response" | "system";
export type TicketEventKind =
  | "created"
  | "reply"
  | "internal_note"
  | "status_change"
  | "assignment"
  | "priority_change"
  | "escalation"
  | "resolution"
  | "csat";

export const TICKET_CATEGORIES: ReadonlyArray<TicketCategory> = [
  "bug_report",
  "feature_request",
  "how_to",
  "account_issue",
  "billing",
  "other",
];
export const TICKET_STATUSES: ReadonlyArray<TicketStatus> = [
  "open",
  "in_progress",
  "awaiting_reply",
  "resolved",
  "closed",
];
export const TICKET_PRIORITIES: ReadonlyArray<TicketPriority> = ["low", "medium", "high", "urgent"];

export interface TicketRecord {
  id: string;
  tenantId: string;
  ticketNumber: string;
  createdBy: string;
  assignedTo: string | null;
  subject: string;
  description: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  /** Canonical monotonic version; every mutation advances it by exactly one. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Approved support permission vocabulary (multi-tenant operations §12).
 * `support.use` and `support.admin` remain as deprecated coarse aliases and
 * expand through {@link expandSupportPermissions}.
 */
export const SUPPORT_REQUESTER_PERMISSIONS = [
  "support.ticket.create",
  "support.ticket.read_own",
  "support.ticket.reply_own",
] as const;

export const SUPPORT_STAFF_PERMISSIONS = [
  "support.ticket.read_tenant",
  "support.ticket.reply",
  "support.ticket.note_internal",
  "support.ticket.assign",
  "support.ticket.manage",
  "support.ticket.escalate",
  "support.config.manage",
  "support.analytics.read",
  "support.knowledge.manage",
] as const;

export const SUPPORT_PERMISSIONS = [
  ...SUPPORT_REQUESTER_PERMISSIONS,
  ...SUPPORT_STAFF_PERMISSIONS,
] as const;

export type SupportPermission = (typeof SUPPORT_PERMISSIONS)[number];

const LEGACY_SUPPORT_ALIASES: Readonly<Record<string, ReadonlyArray<SupportPermission>>> = {
  "support.use": SUPPORT_REQUESTER_PERMISSIONS,
  "support.admin": [...SUPPORT_REQUESTER_PERMISSIONS, ...SUPPORT_STAFF_PERMISSIONS],
};

/**
 * Expands granted permission strings into the approved vocabulary. Unknown
 * strings are dropped rather than passed through, so a typo cannot become an
 * implicit grant.
 */
export function expandSupportPermissions(
  granted: ReadonlyArray<string>,
): ReadonlyArray<SupportPermission> {
  const expanded = new Set<SupportPermission>();
  for (const grant of granted) {
    const alias = LEGACY_SUPPORT_ALIASES[grant];
    if (alias) {
      for (const permission of alias) expanded.add(permission);
      continue;
    }
    if ((SUPPORT_PERMISSIONS as ReadonlyArray<string>).includes(grant)) {
      expanded.add(grant as SupportPermission);
    }
  }
  return [...expanded];
}

export type OutboxEventKind = TicketEventKind | "tombstone";

export type OutboxEventStatus = "pending" | "delivered" | "dead";

/**
 * Versioned queue-metadata envelope written to the transactional outbox and
 * consumed by the owner projection. It never carries subjects, bodies,
 * messages, or attachment content; the tenant migration structurally denies
 * those keys.
 */
export interface TicketOutboxEnvelope {
  schemaVersion: 1;
  tenantId: string;
  ticketNumber: string;
  ticketVersion: number;
  kind: OutboxEventKind;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  /** Opaque assignee reference; never a display name or email address. */
  assignedRef: string | null;
  openedAt: string;
  updatedAt: string;
  occurredAt: string;
}

/** Deterministic consumer idempotency key: one event per canonical version. */
export function outboxIdempotencyKey(
  envelope: Pick<TicketOutboxEnvelope, "tenantId" | "ticketNumber" | "ticketVersion">,
): string {
  return `${envelope.tenantId}/${envelope.ticketNumber}/${envelope.ticketVersion}`;
}

export interface OutboxEventRecord {
  id: number;
  tenantId: string;
  ticketId: string;
  ticketNumber: string;
  ticketVersion: number;
  kind: OutboxEventKind;
  payload: TicketOutboxEnvelope;
  occurredAt: Date;
  status: OutboxEventStatus;
  attempts: number;
  claimedAt: Date | null;
  deliveredAt: Date | null;
  lastError: string | null;
}

/** Content-minimized projection safe for the first brokered read capability. */
export interface SupportTicketSummary {
  ticketNumber: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  updatedAt: string;
}

export interface TicketMessageRecord {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  messageType: MessageType;
  createdAt: Date;
}

export interface TicketEventRecord {
  id: string;
  ticketId: string;
  actor: AuditActor;
  kind: TicketEventKind;
  detail: Readonly<Record<string, string | number | boolean | null>>;
  createdAt: Date;
}
