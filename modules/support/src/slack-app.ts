import { createHmac, timingSafeEqual } from "node:crypto";
import type { TicketStatus } from "./types";

export type SlackTicketAction = "acknowledge" | "assign_self" | "resolve";

export interface SlackActionAuthority {
  installationId: string;
  tenantId: string;
  actorId: string;
  kind: "requester" | "tenant_admin" | "installation_owner" | "managed_support";
  permissions: ReadonlyArray<string>;
}

export interface SlackAppConnection {
  id: string;
  installationId: string;
  tenantId: string;
  workspaceRef: string;
  active: boolean;
}

export interface SlackAppChannel {
  id: string;
  installationId: string;
  tenantId: string;
  connectionId: string;
  channelRef: string;
  active: boolean;
}

export interface SlackTicketThread {
  id: string;
  installationId: string;
  tenantId: string;
  connectionId: string;
  channelId: string;
  threadRef: string;
  ticketId: string;
  ticketVersion: number;
}

export interface SlackIdentityMapping {
  id: string;
  installationId: string;
  tenantId: string;
  connectionId: string;
  providerUserRef: string;
  actorId: string;
  active: boolean;
}

export interface SlackActionPayload {
  actionId: string;
  installationId: string;
  tenantId: string;
  connectionId: string;
  workspaceRef: string;
  channelId: string;
  threadId: string;
  providerUserRef: string;
  ticketId: string;
  expectedTicketVersion: number;
  action: SlackTicketAction;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedSlackAction {
  payload: SlackActionPayload;
  signature: string;
}

export interface SlackActionVerifier {
  readonly kind: "synthetic";
  verify(action: SignedSlackAction): boolean;
}

interface SlackAppTicket {
  installationId: string;
  tenantId: string;
  ticketId: string;
  ticketNumber: string;
  requesterId: string;
  status: TicketStatus;
  assignedTo: string | null;
  version: number;
}

interface SlackActionEvidence {
  installationId: string;
  tenantId: string;
  actorId: string;
  action: string;
  subjectRef: string;
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ACTION_TTL_MS = 5 * 60 * 1_000;

function validRef(value: string): boolean {
  return SAFE_REF.test(value);
}

function canonicalPayload(payload: SlackActionPayload): string {
  return JSON.stringify([
    payload.actionId,
    payload.installationId,
    payload.tenantId,
    payload.connectionId,
    payload.workspaceRef,
    payload.channelId,
    payload.threadId,
    payload.providerUserRef,
    payload.ticketId,
    payload.expectedTicketVersion,
    payload.action,
    payload.issuedAt,
    payload.expiresAt,
  ]);
}

/**
 * Development-only signature boundary. It deliberately has no OAuth,
 * credential-vault, provider SDK, fetch, or external callback capability.
 */
export class SyntheticSlackActionVerifier implements SlackActionVerifier {
  readonly kind = "synthetic" as const;

  constructor(private readonly signingKey: string) {
    if (signingKey.length < 16) throw new Error("synthetic signing key too short");
  }

  sign(payload: SlackActionPayload): SignedSlackAction {
    return {
      payload: { ...payload },
      signature: createHmac("sha256", this.signingKey)
        .update(canonicalPayload(payload))
        .digest("base64url"),
    };
  }

  verify(action: SignedSlackAction): boolean {
    const expected = createHmac("sha256", this.signingKey)
      .update(canonicalPayload(action.payload))
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(action.signature, "base64url");
    } catch {
      return false;
    }
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}

export class InMemorySlackAppStore {
  readonly connections: SlackAppConnection[] = [];
  readonly channels: SlackAppChannel[] = [];
  readonly threads: SlackTicketThread[] = [];
  readonly identities: SlackIdentityMapping[] = [];
  readonly tickets: SlackAppTicket[] = [];
  readonly evidence: SlackActionEvidence[] = [];
  readonly actionReceipts = new Set<string>();
  private readonly authorities = new Map<string, SlackActionAuthority>();

  seedTicket(ticket: SlackAppTicket): void {
    this.tickets.push({ ...ticket });
  }

  ticket(installationId: string, tenantId: string, ticketId: string): SlackAppTicket | undefined {
    return this.tickets.find((ticket) =>
      ticket.installationId === installationId
      && ticket.tenantId === tenantId
      && ticket.ticketId === ticketId);
  }

  replaceAuthority(
    installationId: string,
    tenantId: string,
    actorId: string,
    authority: SlackActionAuthority,
  ): void {
    if (
      authority.installationId !== installationId
      || authority.tenantId !== tenantId
      || authority.actorId !== actorId
    ) throw new Error("Slack authority scope denied");
    this.authorities.set(`${installationId}/${tenantId}/${actorId}`, { ...authority });
  }

  authority(installationId: string, tenantId: string, actorId: string): SlackActionAuthority | undefined {
    return this.authorities.get(`${installationId}/${tenantId}/${actorId}`);
  }

  disableIdentity(installationId: string, tenantId: string, mappingId: string): void {
    const mapping = this.identities.find((candidate) =>
      candidate.installationId === installationId
      && candidate.tenantId === tenantId
      && candidate.id === mappingId);
    if (mapping) mapping.active = false;
  }
}

function requireConfigAuthority(authority: SlackActionAuthority): void {
  if (
    !validRef(authority.installationId)
    || !validRef(authority.tenantId)
    || !validRef(authority.actorId)
    || authority.kind !== "tenant_admin"
    || !authority.permissions.includes("support.config.manage")
  ) throw new Error("Slack configuration access denied");
}

export class SlackAppContractService {
  /** Explicit proof that this contract service owns no provider transport. */
  readonly providerCalls = 0;

  constructor(
    private readonly store: InMemorySlackAppStore,
    private readonly verifier: SlackActionVerifier,
  ) {}

  connect(
    authority: SlackActionAuthority,
    input: { connectionId: string; workspaceRef: string },
  ): SlackAppConnection {
    requireConfigAuthority(authority);
    if (!validRef(input.connectionId) || !validRef(input.workspaceRef)) {
      throw new Error("invalid Slack connection reference");
    }
    const record: SlackAppConnection = {
      id: input.connectionId,
      installationId: authority.installationId,
      tenantId: authority.tenantId,
      workspaceRef: input.workspaceRef,
      active: true,
    };
    this.store.connections.push(record);
    this.store.replaceAuthority(
      authority.installationId,
      authority.tenantId,
      authority.actorId,
      authority,
    );
    return { ...record };
  }

  addChannel(
    authority: SlackActionAuthority,
    input: { connectionId: string; channelId: string; channelRef: string },
  ): SlackAppChannel {
    requireConfigAuthority(authority);
    const connection = this.connection(authority, input.connectionId);
    if (!validRef(input.channelId) || !validRef(input.channelRef)) {
      throw new Error("invalid Slack channel reference");
    }
    const record: SlackAppChannel = {
      id: input.channelId,
      installationId: connection.installationId,
      tenantId: connection.tenantId,
      connectionId: connection.id,
      channelRef: input.channelRef,
      active: true,
    };
    this.store.channels.push(record);
    return { ...record };
  }

  bindThread(
    authority: SlackActionAuthority,
    input: {
      connectionId: string;
      channelId: string;
      threadId: string;
      threadRef: string;
      ticketId: string;
      ticketVersion: number;
    },
  ): SlackTicketThread {
    requireConfigAuthority(authority);
    const connection = this.connection(authority, input.connectionId);
    const channel = this.store.channels.find((candidate) =>
      candidate.installationId === authority.installationId
      && candidate.tenantId === authority.tenantId
      && candidate.connectionId === connection.id
      && candidate.id === input.channelId
      && candidate.active);
    const ticket = this.store.ticket(authority.installationId, authority.tenantId, input.ticketId);
    if (
      !channel
      || !ticket
      || !validRef(input.threadId)
      || !validRef(input.threadRef)
      || ticket.version !== input.ticketVersion
    ) throw new Error("Slack thread scope denied");
    const record: SlackTicketThread = {
      id: input.threadId,
      installationId: authority.installationId,
      tenantId: authority.tenantId,
      connectionId: connection.id,
      channelId: channel.id,
      threadRef: input.threadRef,
      ticketId: ticket.ticketId,
      ticketVersion: ticket.version,
    };
    this.store.threads.push(record);
    return { ...record };
  }

  mapIdentity(
    authority: SlackActionAuthority,
    input: {
      connectionId: string;
      mappingId: string;
      providerUserRef: string;
      actorId: string;
    },
  ): SlackIdentityMapping {
    requireConfigAuthority(authority);
    const connection = this.connection(authority, input.connectionId);
    if (![input.mappingId, input.providerUserRef, input.actorId].every(validRef)) {
      throw new Error("invalid Slack identity reference");
    }
    const record: SlackIdentityMapping = {
      id: input.mappingId,
      installationId: authority.installationId,
      tenantId: authority.tenantId,
      connectionId: connection.id,
      providerUserRef: input.providerUserRef,
      actorId: input.actorId,
      active: true,
    };
    this.store.identities.push(record);
    return { ...record };
  }

  async handleSignedAction(signed: SignedSlackAction): Promise<SlackAppTicket> {
    if (!this.verifier.verify(signed)) throw new Error("Slack action signature denied");
    const payload = signed.payload;
    const expiresAt = Date.parse(payload.expiresAt);
    const issuedAt = Date.parse(payload.issuedAt);
    if (
      !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || expiresAt <= Date.now()
      || issuedAt > Date.now()
      || issuedAt >= expiresAt
      || expiresAt - issuedAt > ACTION_TTL_MS
    ) throw new Error("stale Slack action");
    if (this.store.actionReceipts.has(payload.actionId)) {
      throw new Error("Slack action replay denied");
    }
    const connection = this.store.connections.find((candidate) =>
      candidate.id === payload.connectionId
      && candidate.installationId === payload.installationId
      && candidate.tenantId === payload.tenantId
      && candidate.workspaceRef === payload.workspaceRef
      && candidate.active);
    const channel = this.store.channels.find((candidate) =>
      candidate.id === payload.channelId
      && candidate.installationId === payload.installationId
      && candidate.tenantId === payload.tenantId
      && candidate.connectionId === payload.connectionId
      && candidate.active);
    const thread = this.store.threads.find((candidate) =>
      candidate.id === payload.threadId
      && candidate.installationId === payload.installationId
      && candidate.tenantId === payload.tenantId
      && candidate.connectionId === payload.connectionId
      && candidate.channelId === payload.channelId
      && candidate.ticketId === payload.ticketId);
    if (!connection || !channel || !thread) throw new Error("Slack action scope denied");

    const mapping = this.store.identities.find((candidate) =>
      candidate.installationId === payload.installationId
      && candidate.tenantId === payload.tenantId
      && candidate.connectionId === payload.connectionId
      && candidate.providerUserRef === payload.providerUserRef
      && candidate.active);
    if (!mapping) throw new Error("Slack identity denied");
    const authority = this.store.authority(
      payload.installationId,
      payload.tenantId,
      mapping.actorId,
    );
    if (!authority) throw new Error("Slack action authorization denied");

    const ticket = this.store.ticket(payload.installationId, payload.tenantId, payload.ticketId);
    if (!ticket || ticket.version !== payload.expectedTicketVersion) {
      throw new Error("stale Slack action");
    }
    this.authorizeAction(authority, ticket, payload.action);

    if (payload.action === "acknowledge") ticket.status = "in_progress";
    if (payload.action === "assign_self") ticket.assignedTo = authority.actorId;
    if (payload.action === "resolve") ticket.status = "resolved";
    ticket.version += 1;
    this.store.actionReceipts.add(payload.actionId);
    this.store.evidence.push({
      installationId: payload.installationId,
      tenantId: payload.tenantId,
      actorId: authority.actorId,
      action: `support.slack_action.${payload.action === "acknowledge" ? "acknowledged" : payload.action === "assign_self" ? "assigned" : "resolved"}`,
      subjectRef: ticket.ticketNumber,
    });
    return { ...ticket };
  }

  private connection(authority: SlackActionAuthority, connectionId: string): SlackAppConnection {
    const connection = this.store.connections.find((candidate) =>
      candidate.id === connectionId
      && candidate.installationId === authority.installationId
      && candidate.tenantId === authority.tenantId
      && candidate.active);
    if (!connection) throw new Error("Slack connection scope denied");
    return connection;
  }

  private authorizeAction(
    authority: SlackActionAuthority,
    ticket: SlackAppTicket,
    action: SlackTicketAction,
  ): void {
    if (
      authority.installationId !== ticket.installationId
      || authority.tenantId !== ticket.tenantId
    ) throw new Error("Slack action authorization denied");
    const required = action === "assign_self"
      ? "support.ticket.assign"
      : "support.ticket.manage";
    if (
      authority.kind !== "tenant_admin"
      || !authority.permissions.includes(required)
    ) throw new Error("Slack action authorization denied");
  }
}
