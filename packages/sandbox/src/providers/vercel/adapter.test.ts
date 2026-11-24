import { describe, expect, it, vi } from "vitest";
import type { SandboxCreateRequest, SandboxId } from "../../contracts";
import { VercelSandboxAdapter } from "./adapter";
import {
  VercelSandboxClientError,
  type VercelSandboxCreateInput,
  type VercelSandboxInstance,
  type VercelSandboxProviderClient,
} from "./client";

const now = new Date("2026-07-19T21:30:00.000Z");

function request(
  network: SandboxCreateRequest["network"] = { mode: "deny_all", allowedHosts: [] },
): SandboxCreateRequest {
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
      memoryMb: 2_048,
      durationMs: 30 * 60_000,
      commandTimeoutMs: 5 * 60_000,
      commandOutputBytes: 1_000_000,
      fileBytes: 1_000_000,
      fileCount: 100,
    },
    network,
  };
}

interface FakeInstance extends VercelSandboxInstance {
  readonly writeFiles: ReturnType<typeof vi.fn<VercelSandboxInstance["writeFiles"]>>;
  readonly runCommand: ReturnType<typeof vi.fn<VercelSandboxInstance["runCommand"]>>;
  readonly updatePorts: ReturnType<typeof vi.fn<VercelSandboxInstance["updatePorts"]>>;
  readonly domain: ReturnType<typeof vi.fn<VercelSandboxInstance["domain"]>>;
  readonly snapshot: ReturnType<typeof vi.fn<VercelSandboxInstance["snapshot"]>>;
  readonly readFile: ReturnType<typeof vi.fn<VercelSandboxInstance["readFile"]>>;
  readonly stop: ReturnType<typeof vi.fn<VercelSandboxInstance["stop"]>>;
}

function instance(id = "sbx_1"): FakeInstance {
  return {
    id,
    createdAt: now,
    writeFiles: vi.fn(async () => undefined),
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      startedAt: now,
      finishedAt: new Date(now.getTime() + 25),
    })),
    updatePorts: vi.fn(async () => undefined),
    domain: vi.fn(() => "https://sbx-1.vercel.run"),
    snapshot: vi.fn(async () => ({ id: "snap_1", createdAt: now })),
    readFile: vi.fn(async () => new TextEncoder().encode("artifact")),
    stop: vi.fn(async () => undefined),
  };
}

function client(instances: FakeInstance[]): {
  provider: VercelSandboxProviderClient;
  create: ReturnType<typeof vi.fn<(input: VercelSandboxCreateInput) => Promise<VercelSandboxInstance>>>;
} {
  const create = vi.fn(async (_input: VercelSandboxCreateInput) => {
    const next = instances.shift();
    if (next === undefined) throw new Error("unexpected create");
    return next;
  });
  return { provider: { create }, create };
}

describe("VercelSandboxAdapter", () => {
  it("maps bounded creation and egress policy without credentials", async () => {
    const remote = instance();
    const fake = client([remote]);
    const adapter = new VercelSandboxAdapter({
      client: fake.provider,
      clock: () => new Date(now),
    });

    const workspace = await adapter.create(
      request({ mode: "allowlist", allowedHosts: ["registry.npmjs.org", "api.github.com"] }),
    );

    expect(workspace).toMatchObject({
      id: "sbx_1",
      provider: "vercel",
      tenantId: "tenant_test",
      workspaceId: "workspace_test",
      status: "ready",
    });
    expect(fake.create).toHaveBeenCalledWith({
      runtime: "node22",
      timeoutMs: 30 * 60_000,
      vcpus: 1,
      networkPolicy: { allow: ["registry.npmjs.org", "api.github.com"] },
    });
    expect(JSON.stringify(fake.create.mock.calls)).not.toContain("credential");
  });

  it("maps structured commands and enforces the combined output limit", async () => {
    const remote = instance();
    remote.runCommand.mockResolvedValue({
      exitCode: 1,
      stdout: "123456",
      stderr: "abcdef",
      startedAt: now,
      finishedAt: new Date(now.getTime() + 25),
    });
    const fake = client([remote]);
    const adapter = new VercelSandboxAdapter({ client: fake.provider, clock: () => new Date(now) });
    const workspace = await adapter.create(request());

    const result = await adapter.runCommand({
      sandboxId: workspace.id,
      executable: "pnpm",
      args: ["test", "--runInBand"],
      cwd: "workspace/app",
      timeoutMs: 60_000,
      outputLimitBytes: 8,
    });

    expect(remote.runCommand).toHaveBeenCalledWith({
      cmd: "pnpm",
      args: ["test", "--runInBand"],
      cwd: "workspace/app",
      timeoutMs: 60_000,
      outputLimitBytes: 8,
    });
    expect(result).toMatchObject({ stdout: "123456", stderr: "ab", outputTruncated: true });
  });

  it("returns only an authenticated OpenTenant preview URL", async () => {
    const remote = instance();
    const fake = client([remote]);
    const protectPreview = vi.fn(async () => new URL("https://preview.opentenant.test/p/opaque"));
    const adapter = new VercelSandboxAdapter({
      client: fake.provider,
      clock: () => new Date(now),
      protectPreview,
    });
    const workspace = await adapter.create(request());

    const preview = await adapter.startPreview({
      sandboxId: workspace.id,
      port: 3_000,
      path: "/dashboard",
      expiresInMs: 60_000,
    });

    expect(remote.updatePorts).toHaveBeenCalledWith([3_000]);
    expect(protectPreview).toHaveBeenCalledWith({
      rawUrl: new URL("https://sbx-1.vercel.run/dashboard"),
      sandboxId: workspace.id,
      tenantId: "tenant_test",
      workspaceId: "workspace_test",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(preview).toEqual({
      url: new URL("https://preview.opentenant.test/p/opaque"),
      expiresAt: new Date(now.getTime() + 60_000),
      authenticated: true,
    });
    expect(preview.url.hostname).not.toBe("sbx-1.vercel.run");
  });

  it("fails previews closed when no authenticated preview mediator is configured", async () => {
    const remote = instance();
    const fake = client([remote]);
    const adapter = new VercelSandboxAdapter({ client: fake.provider, clock: () => new Date(now) });
    const workspace = await adapter.create(request());

    expect(adapter.capabilities.authenticatedPreviews).toBe(false);
    await expect(
      adapter.startPreview({
        sandboxId: workspace.id,
        port: 3_000,
        path: "/",
        expiresInMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: "unsupported", operation: "start_preview" });
    expect(remote.domain).not.toHaveBeenCalled();
  });

  it("snapshots as a fork, restores tenant binding, reads artifacts, and stops deterministically", async () => {
    const original = instance();
    const restored = instance("sbx_2");
    const fake = client([original, restored]);
    const adapter = new VercelSandboxAdapter({ client: fake.provider, clock: () => new Date(now) });
    const workspace = await adapter.create(request());
    await adapter.writeFiles({
      sandboxId: workspace.id,
      files: [{ path: "workspace/app/result.txt", contents: new TextEncoder().encode("result") }],
    });
    const checkpoint = await adapter.checkpoint({ sandboxId: workspace.id, label: "before" });
    const fork = await adapter.restore({
      checkpointId: checkpoint.id,
      tenantId: "tenant_test",
      workspaceId: "workspace_fork",
      limits: request().limits,
      network: request().network,
    });
    const artifact = await adapter.collectArtifact({
      sandboxId: fork.id,
      path: "workspace/app/result.txt",
      maxBytes: 100,
    });
    await adapter.terminate(fork.id);
    await adapter.terminate(fork.id);

    expect(original.writeFiles).toHaveBeenCalledOnce();
    expect(original.snapshot).toHaveBeenCalledWith({ label: "before" });
    expect(fake.create).toHaveBeenLastCalledWith({
      runtime: "node22",
      timeoutMs: 30 * 60_000,
      vcpus: 1,
      networkPolicy: "deny-all",
      source: { type: "snapshot", snapshotId: "snap_1" },
    });
    expect(new TextDecoder().decode(artifact.contents)).toBe("artifact");
    expect(restored.stop).toHaveBeenCalledOnce();
  });

  it("reports process logs and unenforceable memory limits as unsupported", async () => {
    const fake = client([]);
    const adapter = new VercelSandboxAdapter({ client: fake.provider });

    expect(adapter.capabilities).toMatchObject({
      structuredCommands: true,
      checkpoints: "fork",
      processLogs: false,
      resourceLimits: false,
      networkPolicy: true,
      deterministicTeardown: true,
    });
    await expect(
      adapter.readLogs({
        sandboxId: "sbx_missing" as SandboxId,
        process: "web",
        tailLines: 10,
      }),
    ).rejects.toMatchObject({ code: "unsupported", operation: "read_logs" });
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("normalizes provider errors without exposing arguments or upstream messages", async () => {
    const remote = instance();
    const fake = client([remote]);
    remote.runCommand.mockRejectedValue(
      new VercelSandboxClientError("rate_limited", {
        cause: new Error("token=provider-secret argument=tenant-secret"),
      }),
    );
    const adapter = new VercelSandboxAdapter({ client: fake.provider, clock: () => new Date(now) });
    const workspace = await adapter.create(request());

    const error = await adapter
      .runCommand({
        sandboxId: workspace.id,
        executable: "pnpm",
        args: ["--token=tenant-secret"],
        cwd: "workspace/app",
        timeoutMs: 60_000,
        outputLimitBytes: 100,
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "rate_limited",
      operation: "run_command",
      retryable: true,
    });
    expect(String(error)).not.toContain("provider-secret");
    expect(JSON.stringify(error)).not.toContain("tenant-secret");
  });
});
