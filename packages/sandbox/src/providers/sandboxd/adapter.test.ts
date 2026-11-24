import { describe, expect, it, vi } from "vitest";
import type { SandboxCreateRequest, SandboxId } from "../../contracts";
import { SandboxdAdapter } from "./adapter";
import { SandboxdClient } from "./client";

const now = new Date("2026-07-19T21:00:00.000Z");

function request(): SandboxCreateRequest {
  return {
    tenantId: "tenant_test",
    workspaceId: "workspace_test",
    template: {
      id: "react-vite",
      version: "1.0.0",
      digest: "sha256:0123456789abcdef",
    },
    limits: {
      cpuCores: 1,
      memoryMb: 512,
      durationMs: 30 * 60_000,
      commandTimeoutMs: 5 * 60_000,
      commandOutputBytes: 1_000_000,
      fileBytes: 1_000_000,
      fileCount: 100,
    },
    network: { mode: "deny_all", allowedHosts: [] },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function remoteSandbox(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "remote_1",
    status: "running",
    template: "react-vite",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    preview: {
      url: "https://remote-1.preview.example.test/",
      port: 3000,
      status: "up",
    },
    ...changes,
  };
}

describe("SandboxdClient", () => {
  it("uses bearer authentication and a private tenant-attributed create request", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      json(remoteSandbox(), 201),
    );
    const client = new SandboxdClient({
      baseUrl: "https://sandboxd.example.test",
      bearerToken: "secret-token",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.createSandbox({
      runtimePreset: "react-vite",
      projectId: "workspace_test",
      userId: "tenant_test",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://sandboxd.example.test/v1/sandboxes");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      runtime_preset: "react-vite",
      visibility: "private",
      project: { id: "workspace_test", user_id: "tenant_test" },
    });
  });

  it("encodes file paths and sends raw bytes", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
    );
    const client = new SandboxdClient({
      baseUrl: "https://sandboxd.example.test/",
      bearerToken: "secret-token",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.putFile("sandbox/a", "workspace/app/a file.txt", new TextEncoder().encode("x"));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://sandboxd.example.test/v1/sandboxes/sandbox%2Fa/files?path=workspace%2Fapp%2Fa+file.txt",
    );
    expect(init).toMatchObject({ method: "PUT" });
    expect(init?.body).toBeInstanceOf(ArrayBuffer);
  });

  it("maps upstream failures without exposing response bodies or the token", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      json({ error: "token=upstream-secret" }, 503),
    );
    const client = new SandboxdClient({
      baseUrl: "https://sandboxd.example.test",
      bearerToken: "secret-token",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const error = await client.getSandbox("missing").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "provider_unavailable", operation: "create" });
    expect(String(error)).not.toContain("upstream-secret");
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });

  it("rejects malformed success responses", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      json({ id: 42 }, 200),
    );
    const client = new SandboxdClient({
      baseUrl: "https://sandboxd.example.test",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.getSandbox("malformed")).rejects.toMatchObject({
      code: "provider_failure",
    });
  });
});

describe("SandboxdAdapter", () => {
  it("advertises the documented gaps and refuses structured commands before I/O", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = new SandboxdAdapter({
      client: new SandboxdClient({
        baseUrl: "https://sandboxd.example.test",
        fetch: fetchMock,
      }),
      clock: () => new Date(now),
    });

    expect(adapter.capabilities).toEqual({
      structuredCommands: false,
      previews: true,
      checkpoints: "fork",
      processLogs: true,
      artifacts: true,
      resourceLimits: false,
      networkPolicy: false,
      authenticatedPreviews: true,
      deterministicTeardown: true,
    });
    await expect(
      adapter.runCommand({
        sandboxId: "sandbox_test" as SandboxId,
        executable: "pnpm",
        args: ["test"],
        cwd: "workspace/app",
        timeoutMs: 60_000,
        outputLimitBytes: 100_000,
      }),
    ).rejects.toMatchObject({ code: "unsupported", operation: "run_command" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes lifecycle, files, previews, snapshots, logs, restore, and teardown", async () => {
    const responses = [
      json(remoteSandbox(), 201),
      new Response(null, { status: 200 }),
      json(remoteSandbox()),
      json(remoteSandbox({ status: "stopped" })),
      json({ id: "snapshot_1", name: "before", created_at: now.toISOString() }, 201),
      json(remoteSandbox()),
      json({ process: "web", lines: ["one", "two"] }),
      new Response("artifact", { status: 200 }),
      json(remoteSandbox({ id: "remote_2" }), 201),
      new Response(null, { status: 200 }),
    ];
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      responses.shift() ?? json({ error: "unexpected" }, 500),
    );
    const adapter = new SandboxdAdapter({
      client: new SandboxdClient({
        baseUrl: "https://sandboxd.example.test",
        fetch: fetchMock as unknown as typeof fetch,
      }),
      clock: () => new Date(now),
    });

    const workspace = await adapter.create(request());
    await adapter.writeFiles({
      sandboxId: workspace.id,
      files: [{ path: "workspace/app/result.txt", contents: new TextEncoder().encode("result") }],
    });
    const preview = await adapter.startPreview({
      sandboxId: workspace.id,
      port: 3000,
      path: "/",
      expiresInMs: 60_000,
    });
    const checkpoint = await adapter.checkpoint({ sandboxId: workspace.id, label: "before" });
    const logs = await adapter.readLogs({
      sandboxId: workspace.id,
      process: "web",
      tailLines: 10,
    });
    const artifact = await adapter.collectArtifact({
      sandboxId: workspace.id,
      path: "workspace/app/result.txt",
      maxBytes: 100,
    });
    const restored = await adapter.restore({
      checkpointId: checkpoint.id,
      tenantId: request().tenantId,
      workspaceId: "restored",
      limits: request().limits,
      network: request().network,
    });
    await adapter.terminate(workspace.id);

    expect(workspace).toMatchObject({ provider: "sandboxd", status: "ready" });
    expect(preview).toMatchObject({ authenticated: true });
    expect(logs.lines).toEqual(["one", "two"]);
    expect(new TextDecoder().decode(artifact.contents)).toBe("artifact");
    expect(restored.id).not.toBe(workspace.id);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("rejects preview URLs that could expose a provider credential", async () => {
    const responses = [
      json(remoteSandbox(), 201),
      json(
        remoteSandbox({
          preview: {
            url: "https://remote-1.preview.example.test/?token=provider-secret",
            port: 3000,
            status: "up",
          },
        }),
      ),
    ];
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      responses.shift() ?? json({ error: "unexpected" }, 500),
    );
    const adapter = new SandboxdAdapter({
      client: new SandboxdClient({
        baseUrl: "https://sandboxd.example.test",
        fetch: fetchMock as unknown as typeof fetch,
      }),
      clock: () => new Date(now),
    });
    const workspace = await adapter.create(request());

    const error = await adapter
      .startPreview({
        sandboxId: workspace.id,
        port: 3000,
        path: "/",
        expiresInMs: 60_000,
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "provider_failure", operation: "start_preview" });
    expect(String(error)).not.toContain("provider-secret");
  });
});
