import { describe, expect, it } from "vitest";
import {
  EncryptedSlackCredentialBoundary,
  InMemorySlackTransport,
  LocalSlackDeliveryAdapter,
  SlackDeliveryError,
  projectSlackTicketMessage,
  type SlackTicketNotification,
} from "./slack-delivery";

const notification = (): SlackTicketNotification => ({
  tenantId: "ten_example",
  tenantLabel: "Example Organisation",
  ticketNumber: "SUP-000042",
  ticketVersion: 3,
  category: "account_issue",
  priority: "high",
  status: "open",
  occurredAt: "2026-07-27T12:00:00.000Z",
  deepLink: "https://support.example.test/tickets/SUP-000042",
});

const credentialBoundary = () =>
  new EncryptedSlackCredentialBoundary({
    encrypt: (plaintext, aad) =>
      Buffer.from(`${aad}\u0000${plaintext}`, "utf8").toString("base64"),
    decrypt: (ciphertext, aad) => {
      const decoded = Buffer.from(ciphertext, "base64").toString("utf8");
      const prefix = `${aad}\u0000`;
      if (!decoded.startsWith(prefix)) throw new Error("credential authentication failed");
      return decoded.slice(prefix.length);
    },
  });

describe("Slack safe message projection", () => {
  it("rebuilds messages from the allowlist and escapes user-controlled text", () => {
    const input = {
      ...notification(),
      tenantLabel: "Example <Organisation> & friends",
      subject: "secret subject",
      body: "secret body",
      webhook: "https://hooks.example.test/secret",
      assignedRef: "usr_private",
    };

    const message = projectSlackTicketMessage(input);
    const serialized = JSON.stringify(message);

    expect(message).toMatchObject({ unfurl_links: false, unfurl_media: false });
    expect(serialized).toContain("Example &lt;Organisation&gt; &amp; friends");
    expect(serialized).toContain("SUP-000042");
    expect(serialized).not.toContain("secret subject");
    expect(serialized).not.toContain("secret body");
    expect(serialized).not.toContain("hooks.example");
    expect(serialized).not.toContain("usr_private");
    expect(Object.keys(message).sort()).toEqual(["blocks", "text", "unfurl_links", "unfurl_media"]);
  });

  it("rejects tenant substitution, unsafe links, and unbounded labels", () => {
    expect(() =>
      projectSlackTicketMessage({ ...notification(), deepLink: "javascript:alert(1)" }),
    ).toThrow("invalid Slack ticket deep link");
    expect(() =>
      projectSlackTicketMessage({ ...notification(), tenantLabel: "x".repeat(121) }),
    ).toThrow("invalid Slack tenant label");
    expect(() =>
      projectSlackTicketMessage({
        ...notification(),
        deepLink: "https://support.example.test/tickets/SUP-000042|@channel",
      }),
    ).toThrow("invalid Slack ticket deep link");
    expect(() =>
      projectSlackTicketMessage({
        ...notification(),
        status: "invented" as SlackTicketNotification["status"],
      }),
    ).toThrow("invalid Slack ticket status");
  });
});

describe("local one-way Slack delivery", () => {
  it("resolves the webhook only inside the credential boundary and never exposes it", async () => {
    const secret = "https://hooks.example.test/services/synthetic-secret";
    const credentials = credentialBoundary();
    credentials.store("conn_a", "ten_example", secret);
    expect("withWebhook" in credentials).toBe(false);
    const transport = new InMemorySlackTransport();
    const adapter = new LocalSlackDeliveryAdapter(credentials, transport);

    await adapter.enqueue({
      connectionId: "conn_a",
      tenantId: "ten_example",
      idempotencyKey: "ten_example/SUP-000042/3",
      notification: notification(),
    });
    await adapter.processNext();

    expect(transport.deliveries).toHaveLength(1);
    expect(transport.deliveries[0]?.message.text).toContain("SUP-000042");
    expect(JSON.stringify(transport.deliveries)).not.toContain(secret);
    expect(JSON.stringify(adapter.health())).not.toContain(secret);
    expect(adapter.health()).toMatchObject({
      queuedAttempts: 0,
      permanentFailures: 0,
      lastSafeErrorClass: null,
    });
    expect(adapter.health().lastSuccessAt).toBeInstanceOf(Date);
  });

  it("isolates the same connection reference across exact tenant bindings", async () => {
    const credentials = credentialBoundary();
    credentials.store("conn_shared", "ten_example", "synthetic-webhook-a");
    credentials.store("conn_shared", "ten_other", "synthetic-webhook-b");
    const transport = new InMemorySlackTransport();
    const adapter = new LocalSlackDeliveryAdapter(credentials, transport);

    await adapter.enqueue({
      connectionId: "conn_shared",
      tenantId: "ten_example",
      idempotencyKey: "ten_example/SUP-000042/3",
      notification: notification(),
    });
    await adapter.enqueue({
      connectionId: "conn_shared",
      tenantId: "ten_other",
      idempotencyKey: "ten_other/SUP-000043/1",
      notification: {
        ...notification(),
        tenantId: "ten_other",
        tenantLabel: "Other Organisation",
        ticketNumber: "SUP-000043",
        ticketVersion: 1,
      },
    });

    await adapter.processNext();
    await adapter.processNext();
    expect(transport.deliveries.map((delivery) => delivery.idempotencyKey)).toEqual([
      "ten_example/SUP-000042/3",
      "ten_other/SUP-000043/1",
    ]);
  });

  it("retries transient failures, deduplicates success, and never mutates canonical input", async () => {
    const credentials = credentialBoundary();
    credentials.store("conn_a", "ten_example", "synthetic-webhook");
    const transport = new InMemorySlackTransport([
      new SlackDeliveryError("transient", "synthetic timeout"),
      undefined,
    ]);
    const adapter = new LocalSlackDeliveryAdapter(credentials, transport, { maxAttempts: 3 });
    const canonical = Object.freeze(notification());

    await adapter.enqueue({
      connectionId: "conn_a",
      tenantId: "ten_example",
      idempotencyKey: "ten_example/SUP-000042/3",
      notification: canonical,
    });
    expect((await adapter.processNext()).status).toBe("retry_scheduled");
    expect(adapter.health()).toMatchObject({
      queuedAttempts: 1,
      lastSafeErrorClass: "transient",
    });
    expect((await adapter.processNext()).status).toBe("delivered");
    expect(await adapter.enqueue({
      connectionId: "conn_a",
      tenantId: "ten_example",
      idempotencyKey: "ten_example/SUP-000042/3",
      notification: canonical,
    })).toBe("duplicate");
    expect(canonical).toEqual(notification());
    await expect(adapter.enqueue({
      connectionId: "conn_a",
      tenantId: "ten_example",
      idempotencyKey: "unbound-key",
      notification: { ...notification(), ticketVersion: 4 },
    })).rejects.toThrow("Slack delivery idempotency key mismatch");
  });

  it("dead-letters permanent failures and tenant mismatches without leaking provider errors", async () => {
    const credentials = credentialBoundary();
    credentials.store("conn_a", "ten_example", "synthetic-webhook");
    const transport = new InMemorySlackTransport([
      new SlackDeliveryError("permanent", "provider included synthetic-webhook"),
    ]);
    const adapter = new LocalSlackDeliveryAdapter(credentials, transport);

    await adapter.enqueue({
      connectionId: "conn_a",
      tenantId: "ten_example",
      idempotencyKey: "ten_example/SUP-000042/3",
      notification: notification(),
    });
    expect((await adapter.processNext()).status).toBe("dead");
    expect(adapter.health()).toMatchObject({
      permanentFailures: 1,
      lastSafeErrorClass: "permanent",
    });
    expect(JSON.stringify(adapter.health())).not.toContain("provider included");

    await expect(adapter.enqueue({
      connectionId: "conn_a",
      tenantId: "ten_other",
      idempotencyKey: "ten_other/SUP-000042/3",
      notification: { ...notification(), tenantId: "ten_other" },
    })).rejects.toThrow("Slack credential unavailable");
  });

  it("fails closed on credential decryption errors without retrying or exposing details", async () => {
    const credentials = new EncryptedSlackCredentialBoundary({
      encrypt: () => "synthetic-ciphertext",
      decrypt: () => {
        throw new Error("cipher failure containing synthetic-webhook");
      },
    });
    credentials.store("conn_a", "ten_example", "synthetic-webhook");
    const adapter = new LocalSlackDeliveryAdapter(
      credentials,
      new InMemorySlackTransport(),
    );

    await adapter.enqueue({
      connectionId: "conn_a",
      tenantId: "ten_example",
      idempotencyKey: "ten_example/SUP-000042/3",
      notification: notification(),
    });

    expect((await adapter.processNext()).status).toBe("dead");
    expect(adapter.health()).toMatchObject({
      queuedAttempts: 0,
      permanentFailures: 1,
      lastSafeErrorClass: "credential_unavailable",
    });
    expect(JSON.stringify(adapter.health())).not.toContain("synthetic-webhook");
  });

  it("sends an unmistakably synthetic manual test without ticket or secret data", async () => {
    const credentials = credentialBoundary();
    credentials.store("conn_a", "ten_example", "synthetic-webhook");
    const transport = new InMemorySlackTransport();
    const adapter = new LocalSlackDeliveryAdapter(credentials, transport);

    await adapter.enqueueManualTest("conn_a", "ten_example", "Example Organisation");
    await adapter.processNext();

    const serialized = JSON.stringify(transport.deliveries[0]?.message);
    expect(serialized).toContain("MANUAL TEST");
    expect(serialized).toContain("synthetic");
    expect(serialized).not.toContain("synthetic-webhook");
  });
});
