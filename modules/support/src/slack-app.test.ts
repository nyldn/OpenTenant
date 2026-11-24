import { describe, expect, it } from "vitest";
import {
  InMemorySlackAppStore,
  SlackAppContractService,
  SyntheticSlackActionVerifier,
  type SlackActionAuthority,
} from "./slack-app";

const admin: SlackActionAuthority = {
  installationId: "inst_a",
  tenantId: "ten_a",
  actorId: "admin_a",
  kind: "tenant_admin",
  permissions: ["support.config.manage", "support.ticket.manage", "support.ticket.assign"],
};
// One base instant for every fixture. Deriving issuedAt and expiresAt from two
// separate Date.now() calls put the window at exactly ACTION_TTL_MS, so a single
// millisecond of clock tick between the two lines pushed it over the guard and
// rejected the happy path. The window now sits comfortably inside the TTL; the
// over-TTL case below still exceeds it.
const NOW = Date.now();
const issuedAt = new Date(NOW - 1_000).toISOString();
const expiresAt = new Date(NOW + 239_000).toISOString();

function fixture() {
  const store = new InMemorySlackAppStore();
  store.seedTicket({
    installationId: "inst_a",
    tenantId: "ten_a",
    ticketId: "ticket_a",
    ticketNumber: "SUP-000001",
    requesterId: "requester_a",
    status: "open",
    assignedTo: null,
    version: 3,
  });
  const verifier = new SyntheticSlackActionVerifier("synthetic-signing-key");
  const service = new SlackAppContractService(store, verifier);
  const connection = service.connect(admin, {
    connectionId: "connection_a",
    workspaceRef: "workspace_a",
  });
  const channel = service.addChannel(admin, {
    connectionId: connection.id,
    channelId: "channel_a",
    channelRef: "provider_channel_a",
  });
  const thread = service.bindThread(admin, {
    connectionId: connection.id,
    channelId: channel.id,
    threadId: "thread_a",
    threadRef: "provider_thread_a",
    ticketId: "ticket_a",
    ticketVersion: 3,
  });
  service.mapIdentity(admin, {
    connectionId: connection.id,
    mappingId: "mapping_a",
    providerUserRef: "provider_user_a",
    actorId: "admin_a",
  });
  return { store, verifier, service, connection, channel, thread };
}

describe("provider-independent Slack app contracts", () => {
  it("binds every connection, workspace, channel, thread, action, and identity mapping to installation and tenant", async () => {
    const { store, verifier, service, connection, channel, thread } = fixture();
    const action = verifier.sign({
      actionId: "action_a",
      installationId: "inst_a",
      tenantId: "ten_a",
      connectionId: connection.id,
      workspaceRef: connection.workspaceRef,
      channelId: channel.id,
      threadId: thread.id,
      providerUserRef: "provider_user_a",
      ticketId: "ticket_a",
      expectedTicketVersion: 3,
      action: "acknowledge",
      issuedAt,
      expiresAt,
    });

    await expect(service.handleSignedAction(action)).resolves.toMatchObject({
      installationId: "inst_a",
      tenantId: "ten_a",
      ticketId: "ticket_a",
      status: "in_progress",
      version: 4,
    });
    expect(store.evidence.at(-1)).toMatchObject({
      installationId: "inst_a",
      tenantId: "ten_a",
      actorId: "admin_a",
      action: "support.slack_action.acknowledged",
    });

    const substituted = verifier.sign({
      ...action.payload,
      actionId: "action_cross_tenant",
      tenantId: "ten_b",
    });
    await expect(service.handleSignedAction(substituted)).rejects.toThrow("Slack action scope denied");
    expect(JSON.stringify(store)).not.toContain("synthetic-signing-key");
  });

  it("reauthorizes against canonical ticket state and current mapped authority", async () => {
    const { store, verifier, service, connection, channel, thread } = fixture();
    const base = {
      installationId: "inst_a",
      tenantId: "ten_a",
      connectionId: connection.id,
      workspaceRef: connection.workspaceRef,
      channelId: channel.id,
      threadId: thread.id,
      providerUserRef: "provider_user_a",
      ticketId: "ticket_a",
      expectedTicketVersion: 3,
      issuedAt,
      expiresAt,
    } as const;

    await expect(service.handleSignedAction(verifier.sign({
      ...base,
      actionId: "long_lived_action",
      action: "resolve",
      expiresAt: new Date(NOW + 301_000).toISOString(),
    }))).rejects.toThrow("stale Slack action");

    store.ticket("inst_a", "ten_a", "ticket_a")!.version = 4;
    await expect(service.handleSignedAction(verifier.sign({
      ...base,
      actionId: "stale_action",
      action: "resolve",
    }))).rejects.toThrow("stale Slack action");

    store.ticket("inst_a", "ten_a", "ticket_a")!.version = 3;
    store.replaceAuthority("inst_a", "ten_a", "admin_a", {
      ...admin,
      permissions: ["support.config.manage"],
    });
    await expect(service.handleSignedAction(verifier.sign({
      ...base,
      actionId: "revoked_action",
      action: "resolve",
    }))).rejects.toThrow("Slack action authorization denied");
  });

  it("cannot widen requester or operator authority and rejects replay or inactive mappings", async () => {
    const { store, verifier, service, connection, channel, thread } = fixture();
    const requesterAuthority: SlackActionAuthority = {
      installationId: "inst_a",
      tenantId: "ten_a",
      actorId: "requester_a",
      kind: "requester",
      permissions: ["support.ticket.read_own", "support.ticket.reply_own"],
    };
    store.replaceAuthority("inst_a", "ten_a", "requester_a", requesterAuthority);
    service.mapIdentity(admin, {
      connectionId: connection.id,
      mappingId: "mapping_requester",
      providerUserRef: "provider_requester",
      actorId: "requester_a",
    });
    const signed = verifier.sign({
      actionId: "requester_assign",
      installationId: "inst_a",
      tenantId: "ten_a",
      connectionId: connection.id,
      workspaceRef: connection.workspaceRef,
      channelId: channel.id,
      threadId: thread.id,
      providerUserRef: "provider_requester",
      ticketId: "ticket_a",
      expectedTicketVersion: 3,
      action: "assign_self",
      issuedAt,
      expiresAt,
    });

    await expect(service.handleSignedAction(signed)).rejects.toThrow("Slack action authorization denied");
    expect(store.ticket("inst_a", "ten_a", "ticket_a")).toMatchObject({
      assignedTo: null,
      version: 3,
    });

    const acknowledged = verifier.sign({ ...signed.payload, actionId: "admin_ack", providerUserRef: "provider_user_a", action: "acknowledge" });
    await expect(service.handleSignedAction(acknowledged)).resolves.toBeTruthy();
    await expect(service.handleSignedAction(acknowledged)).rejects.toThrow("Slack action replay denied");

    store.disableIdentity("inst_a", "ten_a", "mapping_requester");
    await expect(service.handleSignedAction(verifier.sign({
      ...signed.payload,
      actionId: "inactive_mapping",
      action: "acknowledge",
    }))).rejects.toThrow("Slack identity denied");
  });

  it("uses only a synthetic verifier and performs no provider or network operation", () => {
    const { verifier, service } = fixture();
    expect(verifier.kind).toBe("synthetic");
    expect(service.providerCalls).toBe(0);
  });
});
