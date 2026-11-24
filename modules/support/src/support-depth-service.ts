import { InMemorySupportDepthStore } from "./support-depth-store";
import {
  ALLOWED_MEDIA_TYPES,
  DELIVERY_MAX_ATTEMPTS,
  DELIVERY_SAFE_ERROR_CLASSES,
  MAX_ATTACHMENT_BYTES,
  SAFE_FILE_NAME,
  SAFE_REFERENCE,
  attachmentMetadata,
  canReadTicket,
  canRegisterAttachment,
  has,
  now,
  validManagedSession,
} from "./support-depth-policy";
import type {
  AttachmentMetadata,
  AttachmentRecord,
  CsatRecord,
  DeliveryAttempt,
  DeliveryChannel,
  DeliveryEvent,
  DeliveryPreference,
  DeliverySafeErrorClass,
  DeliveryTransport,
  SlaPolicy,
  SupportAuthority,
  SupportDepthTicket,
} from "./support-depth-types";
export class SupportDepthService {
  constructor(
    private readonly store: InMemorySupportDepthStore,
    private readonly transport: DeliveryTransport,
  ) {}

  async setDeliveryPreference(
    authority: SupportAuthority,
    input: Omit<DeliveryPreference, "tenantId" | "updatedAt">,
  ): Promise<DeliveryPreference> {
    if (
      !SAFE_REFERENCE.test(input.subjectId) ||
      !SAFE_REFERENCE.test(input.destinationRef) ||
      /@|https?:/iu.test(input.destinationRef)
    ) {
      throw new Error("unsafe delivery reference");
    }
    const ownsPreference =
      authority.kind === "requester" &&
      authority.actorId === input.subjectId &&
      has(authority, "support.ticket.read_own");
    const managesTenant =
      authority.kind === "tenant_admin" && has(authority, "support.ticket.manage");
    if (!ownsPreference && !managesTenant) throw new Error("delivery preference access denied");
    const record: DeliveryPreference = { ...input, tenantId: authority.tenantId, updatedAt: now() };
    const existing = this.store.preferences.findIndex(
      (preference) =>
        preference.tenantId === record.tenantId &&
        preference.subjectId === record.subjectId &&
        preference.channel === record.channel,
    );
    if (existing >= 0) this.store.preferences[existing] = record;
    else this.store.preferences.push(record);
    this.store.appendEvidence(
      authority,
      "support.delivery_preference.updated",
      input.subjectId,
      { channel: input.channel, enabled: input.enabled },
    );
    return { ...record };
  }

  async deliver(
    authority: SupportAuthority,
    input: {
      ticketId: string;
      ticketVersion: number;
      channel: DeliveryChannel;
      event: DeliveryEvent;
    },
  ): Promise<DeliveryAttempt> {
    const ticket = this.store.ticket(authority.tenantId, input.ticketId);
    if (!ticket) throw new Error("ticket not found");
    if (
      authority.kind !== "tenant_admin" ||
      !has(authority, "support.ticket.manage")
    ) {
      throw new Error("delivery access denied");
    }
    if (
      !Number.isInteger(input.ticketVersion) ||
      input.ticketVersion < 1 ||
      !this.store.hasCanonicalTicketVersion(
        authority.tenantId,
        ticket.ticketId,
        input.ticketVersion,
      )
    ) {
      throw new Error("stale ticket version");
    }
    const idempotencyKey =
      `${authority.tenantId}/${ticket.ticketNumber}/${input.ticketVersion}/${input.channel}/${input.event}`;
    const existing = this.store.attempts.find(
      (attempt) => attempt.idempotencyKey === idempotencyKey && attempt.retryOf === null,
    );
    if (existing) return { ...existing };
    const preference = this.store.preferences.find(
      (candidate) =>
        candidate.tenantId === authority.tenantId &&
        candidate.subjectId === ticket.requesterId &&
        candidate.channel === input.channel &&
        candidate.enabled,
    );
    if (!preference) throw new Error("delivery destination unavailable");
    return this.performDelivery(
      authority,
      ticket,
      input,
      preference.destinationRef,
      null,
      null,
      1,
    );
  }

  async retryDelivery(
    authority: SupportAuthority,
    attemptId: string,
  ): Promise<DeliveryAttempt> {
    const previous = this.store.attempts.find(
      (attempt) => attempt.tenantId === authority.tenantId && attempt.id === attemptId,
    );
    if (
      !previous ||
      previous.status !== "failed" ||
      previous.safeErrorClass !== "transient"
    ) {
      throw new Error("delivery retry unavailable");
    }
    const ticket = this.store.ticket(authority.tenantId, previous.ticketId);
    if (
      !ticket ||
      authority.kind !== "tenant_admin" ||
      !has(authority, "support.ticket.manage")
    ) {
      throw new Error("delivery access denied");
    }
    const existingRetry = this.store.attempts.find(
      (attempt) => attempt.tenantId === authority.tenantId && attempt.retryOf === attemptId,
    );
    if (existingRetry) return { ...existingRetry };
    if (previous.attemptNumber >= DELIVERY_MAX_ATTEMPTS) {
      throw new Error("delivery retry budget exhausted");
    }
    return this.performDelivery(
      authority,
      ticket,
      previous,
      previous.destinationRef,
      previous.id,
      previous.rootAttemptId,
      previous.attemptNumber + 1,
    );
  }

  private async performDelivery(
    authority: SupportAuthority,
    ticket: SupportDepthTicket,
    input: Pick<DeliveryAttempt, "ticketVersion" | "channel" | "event">,
    destinationRef: string,
    retryOf: string | null,
    rootAttemptId: string | null,
    attemptNumber: number,
  ): Promise<DeliveryAttempt> {
    const baseKey =
      `${authority.tenantId}/${ticket.ticketNumber}/${input.ticketVersion}/${input.channel}/${input.event}`;
    const id = this.store.nextId("attempt");
    const idempotencyKey = retryOf ? `${baseKey}/retry/${attemptNumber}` : baseKey;
    let result: { ok: true } | { ok: false; safeErrorClass: DeliverySafeErrorClass };
    try {
      const transportResult = await this.transport.deliver({
        tenantId: authority.tenantId,
        destinationRef,
        idempotencyKey,
        channel: input.channel,
        event: input.event,
        ticketNumber: ticket.ticketNumber,
      });
      result =
        transportResult.ok ||
        DELIVERY_SAFE_ERROR_CLASSES.has(transportResult.safeErrorClass)
          ? transportResult
          : { ok: false, safeErrorClass: "permanent" };
    } catch {
      // Provider objects and messages never cross this seam.
      result = { ok: false, safeErrorClass: "transient" };
    }
    const attempt: DeliveryAttempt = {
      id,
      tenantId: authority.tenantId,
      ticketId: ticket.ticketId,
      ticketVersion: input.ticketVersion,
      channel: input.channel,
      event: input.event,
      destinationRef,
      idempotencyKey,
      status: result.ok ? "delivered" : "failed",
      safeErrorClass: result.ok ? null : result.safeErrorClass,
      retryOf,
      rootAttemptId: rootAttemptId ?? id,
      attemptNumber,
      createdAt: now(),
    };
    this.store.attempts.push(attempt);
    this.store.appendEvidence(
      authority,
      result.ok
        ? retryOf
          ? "support.delivery.recovered"
          : "support.delivery.delivered"
        : "support.delivery.failed",
      ticket.ticketNumber,
      {
        channel: input.channel,
        attemptId: attempt.id,
        safeErrorClass: attempt.safeErrorClass,
        retryOf,
      },
    );
    return { ...attempt };
  }

  async registerAttachment(
    authority: SupportAuthority,
    input: Omit<AttachmentRecord, "id" | "tenantId" | "uploadedBy" | "createdAt">,
  ): Promise<AttachmentMetadata> {
    const ticket = this.store.ticket(authority.tenantId, input.ticketId);
    if (!ticket || !canRegisterAttachment(authority, ticket)) {
      throw new Error("attachment access denied");
    }
    if (!ALLOWED_MEDIA_TYPES.has(input.mediaType)) throw new Error("attachment media type denied");
    if (
      !Number.isInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > MAX_ATTACHMENT_BYTES
    ) {
      throw new Error("attachment size denied");
    }
    if (
      !SAFE_FILE_NAME.test(input.fileName) ||
      !SAFE_REFERENCE.test(input.objectRef) ||
      /https?:|\.\./iu.test(input.objectRef)
    ) {
      throw new Error("unsafe attachment reference");
    }
    const record: AttachmentRecord = {
      ...input,
      id: this.store.nextId("attachment"),
      tenantId: authority.tenantId,
      uploadedBy: authority.actorId,
      createdAt: now(),
    };
    this.store.attachments.push(record);
    this.store.appendEvidence(authority, "support.attachment.registered", ticket.ticketNumber, {
      attachmentId: record.id,
      mediaType: record.mediaType,
      byteSize: record.byteSize,
    });
    return attachmentMetadata(record);
  }

  async readAttachment(
    authority: SupportAuthority,
    attachmentId: string,
  ): Promise<AttachmentMetadata> {
    const attachment = this.store.attachments.find(
      (candidate) =>
        candidate.tenantId === authority.tenantId && candidate.id === attachmentId,
    );
    const ticket = attachment && this.store.ticket(authority.tenantId, attachment.ticketId);
    if (!attachment || !ticket || !canReadTicket(authority, ticket)) {
      throw new Error("attachment access denied");
    }
    this.store.appendEvidence(authority, "support.attachment.metadata_read", ticket.ticketNumber, {
      attachmentId,
    });
    return attachmentMetadata(attachment);
  }

  async configureSla(
    authority: SupportAuthority,
    input: Omit<SlaPolicy, "tenantId">,
  ): Promise<SlaPolicy> {
    if (authority.kind !== "tenant_admin" || !has(authority, "support.config.manage")) {
      throw new Error("SLA access denied");
    }
    if (
      !Number.isInteger(input.firstResponseMinutes) ||
      input.firstResponseMinutes < 1 ||
      !Number.isInteger(input.resolutionMinutes) ||
      input.resolutionMinutes < input.firstResponseMinutes
    ) {
      throw new Error("invalid SLA policy");
    }
    const policy = { ...input, tenantId: authority.tenantId };
    const existing = this.store.slaPolicies.findIndex(
      (candidate) =>
        candidate.tenantId === authority.tenantId && candidate.priority === input.priority,
    );
    if (existing >= 0) this.store.slaPolicies[existing] = policy;
    else this.store.slaPolicies.push(policy);
    this.store.appendEvidence(authority, "support.sla_policy.updated", input.priority, {
      firstResponseMinutes: input.firstResponseMinutes,
      resolutionMinutes: input.resolutionMinutes,
    });
    return { ...policy };
  }

  async slaState(
    authority: SupportAuthority,
    ticketId: string,
    at: string,
  ): Promise<{
    state: "running" | "paused" | "stopped";
    activeElapsedMinutes: number;
    firstResponseBreached: boolean;
    resolutionBreached: boolean;
  }> {
    const ticket = this.store.ticket(authority.tenantId, ticketId);
    if (!ticket || !canReadTicket(authority, ticket)) throw new Error("SLA access denied");
    const policy = this.store.slaPolicies.find(
      (candidate) =>
        candidate.tenantId === authority.tenantId && candidate.priority === ticket.priority,
    );
    const state = this.store.slaStates.find(
      (candidate) =>
        candidate.tenantId === authority.tenantId && candidate.ticketId === ticket.ticketId,
    );
    const atMs = Date.parse(at);
    const createdAtMs = Date.parse(ticket.createdAt);
    if (
      !policy ||
      !state ||
      !Number.isFinite(atMs) ||
      !Number.isFinite(createdAtMs) ||
      atMs < createdAtMs ||
      atMs < Date.parse(state.lastTransitionAt)
    ) {
      throw new Error("SLA unavailable");
    }
    const effectiveAtMs =
      state.state === "paused" && state.pausedAt
        ? Date.parse(state.pausedAt)
        : state.state === "stopped"
          ? Date.parse(state.lastTransitionAt)
          : atMs;
    const activeElapsedMinutes = Math.max(
      0,
      (effectiveAtMs - createdAtMs) / 60_000 - state.accumulatedPausedMinutes,
    );
    this.store.appendEvidence(authority, "support.sla_state.read", ticket.ticketNumber, {
      state: state.state,
    });
    return {
      state: state.state,
      activeElapsedMinutes,
      firstResponseBreached:
        !ticket.firstRespondedAt && activeElapsedMinutes >= policy.firstResponseMinutes,
      resolutionBreached:
        !ticket.resolvedAt && activeElapsedMinutes >= policy.resolutionMinutes,
    };
  }

  async submitCsat(
    authority: SupportAuthority,
    input: { ticketId: string; rating: number; comment?: string },
  ): Promise<CsatRecord> {
    const ticket = this.store.ticket(authority.tenantId, input.ticketId);
    if (
      !ticket ||
      authority.kind !== "requester" ||
      authority.actorId !== ticket.requesterId ||
      !has(authority, "support.ticket.read_own") ||
      !["resolved", "closed"].includes(ticket.status)
    ) {
      throw new Error("CSAT access denied");
    }
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new Error("invalid CSAT rating");
    }
    if ((input.comment?.length ?? 0) > 2_000) throw new Error("invalid CSAT comment");
    if (
      this.store.csat.some(
        (record) =>
          record.tenantId === authority.tenantId && record.ticketId === input.ticketId,
      )
    ) {
      throw new Error("CSAT already submitted");
    }
    const record: CsatRecord = {
      tenantId: authority.tenantId,
      ticketId: input.ticketId,
      requesterId: authority.actorId,
      rating: input.rating,
      comment: input.comment ?? null,
      submittedAt: now(),
    };
    this.store.csat.push(record);
    this.store.appendEvidence(authority, "support.csat.submitted", ticket.ticketNumber, {
      rating: input.rating,
    });
    return { ...record };
  }

  async analytics(authority: SupportAuthority): Promise<{
    tenantId: string;
    ticketCount: number;
    resolvedCount: number;
    deliveryFailureCount: number;
    csatResponseCount: number;
    averageCsat: number | null;
  }> {
    const tenantAdmin =
      authority.kind === "tenant_admin" &&
      has(authority, "support.analytics.read");
    const owner =
      (authority.kind === "installation_owner" || authority.kind === "managed_support") &&
      has(authority, "owner.support.customer_data.read") &&
      validManagedSession(authority, authority.tenantId);
    if (!tenantAdmin && !owner) throw new Error("analytics access denied");
    const tickets = this.store.tickets.filter((ticket) => ticket.tenantId === authority.tenantId);
    const responses = this.store.csat.filter((record) => record.tenantId === authority.tenantId);
    const analytics = {
      tenantId: authority.tenantId,
      ticketCount: tickets.length,
      resolvedCount: tickets.filter((ticket) =>
        ["resolved", "closed"].includes(ticket.status),
      ).length,
      deliveryFailureCount: this.store.attempts.filter(
        (attempt) => attempt.tenantId === authority.tenantId && attempt.status === "failed",
      ).length,
      csatResponseCount: responses.length,
      averageCsat:
        responses.length === 0
          ? null
          : responses.reduce((sum, response) => sum + response.rating, 0) / responses.length,
    };
    this.store.appendEvidence(authority, "support.analytics.read", authority.tenantId);
    return analytics;
  }
}
