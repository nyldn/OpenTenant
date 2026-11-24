import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signModuleContext } from "@opentenant/security";

const brokerSupportTicketSummaries = vi.hoisted(() => vi.fn());
vi.mock("../../../../../../lib/module-capability-broker", () => ({ brokerSupportTicketSummaries }));

import { POST } from "./route";

function keyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function context(privateKeyPem: string, overrides: Partial<Parameters<typeof signModuleContext>[0]> = {}): string {
  return signModuleContext({
    tenantId: "tenant_alpha",
    moduleKey: "tenant-portal",
    moduleVersion: "1.0.0",
    userId: "user_alpha",
    permissions: ["tenant-portal.support-ticket-read"],
    brand: { displayName: "Alpha", logoUrl: null, cssBrandKey: "alpha" },
    ...overrides,
  }, privateKeyPem);
}

function request(token: string | null, reservedContext?: string): Request {
  const headers = new Headers();
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  if (reservedContext !== undefined) headers.set("x-opentenant-module-context", reservedContext);
  return new Request("https://alpha.example.test/api/module-broker/tenant-portal/support/tickets", {
    method: "POST",
    headers,
  });
}

const routeContext = { params: Promise.resolve({ module: "tenant-portal" }) };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("support ticket module broker route", () => {
  it("rejects a reserved context header when strict bearer authorization is absent", async () => {
    const keys = keyPair();
    vi.stubEnv("MODULE_SIGNING_PUBLIC_KEY", keys.publicKeyPem);

    const response = await POST(request(null, context(keys.privateKeyPem)), routeContext);

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_context" } });
    expect(brokerSupportTicketSummaries).not.toHaveBeenCalled();
  });

  it("uses a valid identity-backed context and returns only brokered summaries", async () => {
    const keys = keyPair();
    vi.stubEnv("MODULE_SIGNING_PUBLIC_KEY", keys.publicKeyPem);
    const summaries = [{
      ticketNumber: "SUP-000001",
      category: "technical",
      status: "open",
      priority: "medium",
      updatedAt: "2026-07-22T00:00:00.000Z",
    }];
    brokerSupportTicketSummaries.mockResolvedValue({ allowed: true, value: summaries });

    const response = await POST(request(context(keys.privateKeyPem)), routeContext);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { correlationId: string; tickets: unknown[] };
    expect(body.tickets).toEqual(summaries);
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(brokerSupportTicketSummaries).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant_alpha",
        moduleKey: "tenant-portal",
        moduleVersion: "1.0.0",
        userId: "user_alpha",
      }),
      body.correlationId,
    );
    expect(JSON.stringify(body)).not.toContain("subject");
    expect(JSON.stringify(body)).not.toContain("description");
  });

  it("denies anonymous, wrong-module, and policy-denied contexts without leaking reasons", async () => {
    const keys = keyPair();
    vi.stubEnv("MODULE_SIGNING_PUBLIC_KEY", keys.publicKeyPem);

    brokerSupportTicketSummaries.mockResolvedValueOnce({ allowed: false, reason: "identity_required" });
    const anonymous = await POST(request(context(keys.privateKeyPem, { userId: null })), routeContext);
    expect(anonymous.status).toBe(403);
    await expect(anonymous.json()).resolves.toEqual({
      error: { code: "capability_denied" },
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(brokerSupportTicketSummaries).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null }),
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
    );

    const wrongModule = await POST(request(context(keys.privateKeyPem, { moduleKey: "other-module" })), routeContext);
    expect(wrongModule.status).toBe(401);
    await expect(wrongModule.json()).resolves.toEqual({ error: { code: "invalid_context" } });

    brokerSupportTicketSummaries.mockResolvedValue({ allowed: false, reason: "grant_inactive" });
    const denied = await POST(request(context(keys.privateKeyPem)), routeContext);
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({
      error: { code: "capability_denied" },
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
  });

  it("normalizes broker failures without exposing provider or SQL details", async () => {
    const keys = keyPair();
    vi.stubEnv("MODULE_SIGNING_PUBLIC_KEY", keys.publicKeyPem);
    brokerSupportTicketSummaries.mockRejectedValue(new Error("postgresql://secret@host syntax error"));

    const response = await POST(request(context(keys.privateKeyPem)), routeContext);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      error: { code: "broker_failed" },
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(body).not.toContain("postgresql");
    expect(body).not.toContain("syntax");
  });
});
