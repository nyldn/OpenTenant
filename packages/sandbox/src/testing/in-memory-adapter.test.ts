import { describe, expect, it } from "vitest";
import type { SandboxCommandRequest, SandboxCreateRequest } from "../contracts";
import { defineSandboxAdapterConformance } from "./conformance";
import { InMemorySandboxAdapter } from "./in-memory-adapter";

const now = new Date("2026-07-19T20:00:00.000Z");

function request(workspaceId = "workspace_test"): SandboxCreateRequest {
  return {
    tenantId: "tenant_test",
    workspaceId,
    template: {
      id: "react-module",
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

function adapter(): InMemorySandboxAdapter {
  let sequence = 0;
  return new InMemorySandboxAdapter({
    clock: () => new Date(now),
    nextId: (kind) => `${kind}_${++sequence}`,
    commandExecutor: async (command: SandboxCommandRequest) => ({
      exitCode: 0,
      stdout: command.args.at(-1) ?? "",
      stderr: "",
    }),
  });
}

defineSandboxAdapterConformance({
  name: "in-memory",
  provider: "memory",
  createAdapter: adapter,
  createRequest: request,
});

describe("InMemorySandboxAdapter", () => {
  it("copies file bytes at the adapter boundary", async () => {
    const instance = adapter();
    const workspace = await instance.create(request());
    const contents = new TextEncoder().encode("original");

    await instance.writeFiles({
      sandboxId: workspace.id,
      files: [{ path: "workspace/app/value.txt", contents }],
    });
    contents.fill(0);

    const artifact = await instance.collectArtifact({
      sandboxId: workspace.id,
      path: "workspace/app/value.txt",
      maxBytes: 100,
    });
    expect(new TextDecoder().decode(artifact.contents)).toBe("original");
  });

  it("rejects unsupported capabilities before changing state", async () => {
    const instance = new InMemorySandboxAdapter({
      clock: () => new Date(now),
      nextId: (kind) => `${kind}_1`,
      capabilities: {
        structuredCommands: false,
        previews: false,
        checkpoints: "none",
        processLogs: false,
        artifacts: false,
        resourceLimits: false,
        networkPolicy: false,
        authenticatedPreviews: false,
        deterministicTeardown: false,
      },
    });
    const workspace = await instance.create(request());

    await expect(
      instance.startPreview({
        sandboxId: workspace.id,
        port: 3000,
        path: "/",
        expiresInMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: "unsupported", operation: "start_preview" });
  });

  it("rejects operations after the workspace lifetime expires", async () => {
    let currentTime = new Date(now);
    const instance = new InMemorySandboxAdapter({
      clock: () => new Date(currentTime),
      nextId: (kind) => `${kind}_expiry`,
    });
    const workspace = await instance.create(request());
    currentTime = new Date(workspace.expiresAt.getTime());

    await expect(
      instance.writeFiles({ sandboxId: workspace.id, files: [] }),
    ).rejects.toMatchObject({ code: "conflict", operation: "write_files" });
  });
});
