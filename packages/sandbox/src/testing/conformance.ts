import { describe, expect, it } from "vitest";
import type {
  SandboxAdapter,
  SandboxCommandRequest,
  SandboxCreateRequest,
  SandboxId,
} from "../contracts";
import { SandboxError } from "../errors";

const encoder = new TextEncoder();

export interface SandboxConformanceHarness {
  readonly name: string;
  readonly provider: string;
  createAdapter(): SandboxAdapter;
  createRequest(workspaceId?: string): SandboxCreateRequest;
}

function command(sandboxId: SandboxId): SandboxCommandRequest {
  return {
    sandboxId,
    executable: "fixture-command",
    args: ["--emit", "abcdefghij"],
    cwd: "workspace/app",
    timeoutMs: 10_000,
    outputLimitBytes: 5,
  };
}

export function defineSandboxAdapterConformance(harness: SandboxConformanceHarness): void {
  describe(`${harness.name} sandbox conformance`, () => {
    it("creates an attributed, expiring workspace", async () => {
      const adapter = harness.createAdapter();
      const request = harness.createRequest();

      const workspace = await adapter.create(request);

      expect(workspace).toMatchObject({
        provider: harness.provider,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        status: "ready",
      });
      expect(workspace.expiresAt.getTime()).toBe(
        workspace.createdAt.getTime() + request.limits.durationMs,
      );
    });

    it("keeps file state isolated and returns a content digest", async () => {
      const adapter = harness.createAdapter();
      const first = await adapter.create(harness.createRequest("first"));
      const second = await adapter.create(harness.createRequest("second"));

      await adapter.writeFiles({
        sandboxId: first.id,
        files: [{ path: "workspace/app/result.txt", contents: encoder.encode("first") }],
      });
      await adapter.writeFiles({
        sandboxId: second.id,
        files: [{ path: "workspace/app/result.txt", contents: encoder.encode("second") }],
      });

      const firstArtifact = await adapter.collectArtifact({
        sandboxId: first.id,
        path: "workspace/app/result.txt",
        maxBytes: 100,
      });
      const secondArtifact = await adapter.collectArtifact({
        sandboxId: second.id,
        path: "workspace/app/result.txt",
        maxBytes: 100,
      });

      expect(new TextDecoder().decode(firstArtifact.contents)).toBe("first");
      expect(new TextDecoder().decode(secondArtifact.contents)).toBe("second");
      expect(firstArtifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(firstArtifact.digest).not.toBe(secondArtifact.digest);
    });

    it("bounds command output and records process logs", async () => {
      const adapter = harness.createAdapter();
      const workspace = await adapter.create(harness.createRequest());

      if (!adapter.capabilities.structuredCommands) {
        await expect(adapter.runCommand(command(workspace.id))).rejects.toMatchObject({ code: "unsupported" });
        return;
      }
      const result = await adapter.runCommand(command(workspace.id));
      const logs = adapter.capabilities.processLogs ? await adapter.readLogs({
        sandboxId: workspace.id,
        process: "fixture-command",
        tailLines: 10,
      }) : undefined;

      expect(result.stdout).toBe("abcde");
      expect(result.outputTruncated).toBe(true);
      if (logs) expect(logs.lines).toContain("abcdefghij");
    });

    it("creates authenticated previews with bounded expiry", async () => {
      const adapter = harness.createAdapter();
      const workspace = await adapter.create(harness.createRequest());

      if (!adapter.capabilities.authenticatedPreviews) {
        await expect(adapter.startPreview({ sandboxId: workspace.id, port: 3000, path: "/preview", expiresInMs: 60_000 })).rejects.toMatchObject({ code: "unsupported" });
        return;
      }
      const preview = await adapter.startPreview({
        sandboxId: workspace.id,
        port: 3000,
        path: "/preview",
        expiresInMs: 60_000,
      });

      expect(preview.authenticated).toBe(true);
      expect(preview.url.protocol).toBe("https:");
      expect(preview.expiresAt.getTime()).toBeGreaterThan(workspace.createdAt.getTime());
      expect(preview.expiresAt.getTime()).toBeLessThanOrEqual(workspace.expiresAt.getTime());
    });

    it("restores a checkpoint into a new workspace without crossing tenants", async () => {
      const adapter = harness.createAdapter();
      const request = harness.createRequest();
      const workspace = await adapter.create(request);
      if (adapter.capabilities.checkpoints === "none") {
        await expect(adapter.checkpoint({ sandboxId: workspace.id, label: "before" })).rejects.toMatchObject({ code: "unsupported" });
        return;
      }
      await adapter.writeFiles({
        sandboxId: workspace.id,
        files: [{ path: "workspace/app/state.txt", contents: encoder.encode("checkpoint") }],
      });
      const checkpoint = await adapter.checkpoint({ sandboxId: workspace.id, label: "before" });

      const restored = await adapter.restore({
        checkpointId: checkpoint.id,
        tenantId: request.tenantId,
        workspaceId: "restored",
        limits: request.limits,
        network: request.network,
      });
      const artifact = await adapter.collectArtifact({
        sandboxId: restored.id,
        path: "workspace/app/state.txt",
        maxBytes: 100,
      });

      expect(restored.id).not.toBe(workspace.id);
      expect(new TextDecoder().decode(artifact.contents)).toBe("checkpoint");

      await expect(
        adapter.restore({
          checkpointId: checkpoint.id,
          tenantId: "tenant_other",
          workspaceId: "cross-tenant",
          limits: request.limits,
          network: request.network,
        }),
      ).rejects.toMatchObject({ code: "policy_denied" });
    });

    it("terminates idempotently and rejects later operations", async () => {
      const adapter = harness.createAdapter();
      const workspace = await adapter.create(harness.createRequest());

      await adapter.terminate(workspace.id);
      await expect(adapter.terminate(workspace.id)).resolves.toBeUndefined();
      await expect(
        adapter.writeFiles({
          sandboxId: workspace.id,
          files: [{ path: "workspace/app/late.txt", contents: encoder.encode("late") }],
        }),
      ).rejects.toBeInstanceOf(SandboxError);
    });
  });
}
