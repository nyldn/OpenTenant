import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signModuleContext } from "@opentenant/security";
import { BRAIN_MANIFEST } from "@opentenant/brain";
import { handleBrainRequest } from "./host-api";
import type { ModuleHostServices } from "@opentenant/database/module-host";
const POST = (req: Request) => handleBrainRequest(req, { serverConfig: () => process.env } as ModuleHostServices);
const services = vi.hoisted(() => ({ authority: vi.fn(), call: vi.fn() }));
vi.mock("./service", () => ({ brainAuthority: services.authority, brainCall: services.call }));
services.authority.mockResolvedValue(["brain.use"]);
services.call.mockResolvedValue([{ id: "result" }]);

function generatePemKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function brainContext(
  privateKeyPem: string,
  overrides: Partial<Parameters<typeof signModuleContext>[0]> = {},
): string {
  return signModuleContext(
    {
      tenantId: "tenant_brain",
      moduleKey: BRAIN_MANIFEST.key,
      moduleVersion: BRAIN_MANIFEST.version,
      userId: "user_1",
      permissions: ["brain.use"],
      brand: {
        displayName: "Brain Tenant",
        logoUrl: null,
        cssBrandKey: "brain-tenant",
      },
      ...overrides,
    },
    privateKeyPem,
  );
}

function request(token: string | null, body: unknown): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("x-opentenant-module-context", token);
  return new Request("https://tenant.example.test/api/mcp/brain", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  delete process.env.MODULE_SIGNING_PUBLIC_KEY;
});

describe("brain MCP route", () => {
  it("rejects requests without a signed module context", async () => {
    const keyPair = generatePemKeyPair();
    process.env.MODULE_SIGNING_PUBLIC_KEY = keyPair.publicKeyPem;

    const response = await POST(request(null, { method: "tools/call", params: { name: "search" } }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "missing_module_context",
        message: "Signed brain module context is required.",
      },
    });
  });

  it("rejects invalid or wrong-module contexts", async () => {
    const keyPair = generatePemKeyPair();
    process.env.MODULE_SIGNING_PUBLIC_KEY = keyPair.publicKeyPem;
    const token = signModuleContext(
      {
        tenantId: "tenant_brain",
        moduleKey: "assessment",
        moduleVersion: "1.0.0",
        userId: "user_1",
        permissions: ["brain.use"],
        brand: {
          displayName: "Brain Tenant",
          logoUrl: null,
          cssBrandKey: "brain-tenant",
        },
      },
      keyPair.privateKeyPem,
    );

    const response = await POST(request(token, { method: "tools/call", params: { name: "search" } }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_module_context",
        message: "Brain module context is invalid: bad_signature.",
      },
    });
  });

  it("rejects passcode-mode contexts with no userId", async () => {
    const keyPair = generatePemKeyPair();
    process.env.MODULE_SIGNING_PUBLIC_KEY = keyPair.publicKeyPem;

    const response = await POST(
      request(
        brainContext(keyPair.privateKeyPem, { userId: null }),
        { method: "tools/call", params: { name: "search" } },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "identity_required",
        message: "Brain MCP access requires an identity-backed module context.",
      },
    });
  });

  it("requires brain.use for read tools", async () => {
    const keyPair = generatePemKeyPair();
    process.env.MODULE_SIGNING_PUBLIC_KEY = keyPair.publicKeyPem;

    const response = await POST(
      request(
        brainContext(keyPair.privateKeyPem, { permissions: [] }),
        { method: "tools/call", params: { name: "search" } },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "permission_denied",
        message: "search requires brain.use.",
      },
    });
  });

  it("returns 403 for promote tools even when the caller has brain.promote", async () => {
    const keyPair = generatePemKeyPair();
    process.env.MODULE_SIGNING_PUBLIC_KEY = keyPair.publicKeyPem;

    const response = await POST(
      request(
        brainContext(keyPair.privateKeyPem, { permissions: ["brain.use", "brain.promote"] }),
        { method: "tools/call", params: { name: "promote_signal" } },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "permission_denied",
        message: "promote_signal requires brain.promote, which is not granted.",
      },
    });
  });

  it("denies tools/list to contexts without brain.use", async () => {
    const keyPair = generatePemKeyPair();
    process.env.MODULE_SIGNING_PUBLIC_KEY = keyPair.publicKeyPem;

    const response = await POST(
      request(brainContext(keyPair.privateKeyPem, { permissions: [] }), { method: "tools/list" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "permission_denied",
        message: "tools/list requires brain.use.",
      },
    });
  });

  it("executes read tools and lists the tool table", async () => {
    const keyPair = generatePemKeyPair();
    process.env.MODULE_SIGNING_PUBLIC_KEY = keyPair.publicKeyPem;
    const token = brainContext(keyPair.privateKeyPem);

    const listResponse = await POST(request(token, { method: "tools/list" }));
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      tools: [
        {
          name: "search",
          description: "Search validated context and raw signal chunks.",
          requiredPermission: "brain.use",
        },
        {
          name: "get_decision",
          description: "Fetch a single decision-log entry with citations.",
          requiredPermission: "brain.use",
        },
        {
          name: "get_brand_md",
          description: "Read tenant-authored brand markdown for agent grounding.",
          requiredPermission: "brain.use",
        },
        {
          name: "promote_signal",
          description: "Promote a raw signal into validated context.",
          requiredPermission: "brain.promote",
        },
      ],
    });

    const callResponse = await POST(request(token, { method: "tools/call", params: { name: "search" } }));
    expect(callResponse.status).toBe(200);
    expect(await callResponse.json()).toMatchObject({ resultType: "complete", content: [{ type: "text" }], _meta: { trust: "untrusted_tenant_content" } });
  });
  it("denies revoked tenant entitlement even with signed permissions", async () => {
    const pair = generatePemKeyPair(); process.env.MODULE_SIGNING_PUBLIC_KEY = pair.publicKeyPem;
    services.authority.mockResolvedValueOnce([]);
    expect((await POST(request(brainContext(pair.privateKeyPem), { method: "tools/list" }))).status).toBe(403);
  });
});

 it("forwards optional embedding and signal without changing omitted defaults", async () => {
  const pair = generatePemKeyPair();
  process.env.MODULE_SIGNING_PUBLIC_KEY = pair.publicKeyPem;
  const host = { serverConfig: () => process.env } as ModuleHostServices;
  const makeRequest = () => request(brainContext(pair.privateKeyPem), { tool: "search" });
  const embedding = { baseUrl: "https://models.example.test/v1", apiKey: "synthetic-secret", apiVersion: "v1", model: "embedding-snapshot", region: "eu", dimensions: 1536, timeoutMs: 100 } as const;
  const signal = new AbortController().signal;
  expect((await handleBrainRequest(makeRequest(), host, { embedding, signal })).status).toBe(200);
  expect(services.call.mock.lastCall?.[6]).toEqual({ embedding, signal });
  expect(services.call.mock.lastCall?.[6].embedding).toBe(embedding);
  expect(services.call.mock.lastCall?.[6].signal).toBe(signal);
  expect((await handleBrainRequest(makeRequest(), host)).status).toBe(200);
  expect(services.call.mock.lastCall?.[6]).toEqual({});
 });
