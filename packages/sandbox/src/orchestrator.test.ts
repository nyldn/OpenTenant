import { describe, expect, it } from "vitest";
import type { SandboxAdapter, SandboxCapabilities, SandboxId } from "./contracts";
import { sandboxCapabilities } from "./contracts";
import { proveSyntheticModuleLifecycle, type ModuleProofInput } from "./orchestrator";
import {
  digestTemplateFiles,
  SYNTHETIC_MODULE_TEMPLATE,
  type ApprovedModuleTemplate,
} from "./template";
import { InMemorySandboxAdapter } from "./testing/in-memory-adapter";

const limits = {
  cpuCores: 1,
  memoryMb: 512,
  durationMs: 60_000,
  commandTimeoutMs: 10_000,
  commandOutputBytes: 10_000,
  fileBytes: 50_000,
  fileCount: 20,
};

function adapter() {
  return new InMemorySandboxAdapter({
    commandExecutor: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
  });
}

function input(sandboxAdapter: SandboxAdapter): ModuleProofInput {
  return {
    adapter: sandboxAdapter,
    tenantId: "tenant_example",
    workspaceId: "workspace_example",
    limits,
    network: { mode: "deny_all", allowedHosts: [] },
  };
}

class FaultAdapter implements SandboxAdapter {
  readonly provider = "fault";
  readonly capabilities: SandboxCapabilities;
  readonly calls: string[] = [];
  private readonly delegate = adapter();

  constructor(private readonly failure: string | undefined, capabilities?: SandboxCapabilities) {
    this.capabilities = sandboxCapabilities(capabilities ?? this.delegate.capabilities);
  }

  private async call<T>(name: string, run: () => Promise<T>): Promise<T> {
    this.calls.push(name);
    if (this.failure === name) throw new Error(`synthetic ${name} failure`);
    return run();
  }

  create(request: Parameters<SandboxAdapter["create"]>[0]) { return this.call("create", () => this.delegate.create(request)); }
  writeFiles(request: Parameters<SandboxAdapter["writeFiles"]>[0]) { return this.call("writeFiles", () => this.delegate.writeFiles(request)); }
  runCommand(request: Parameters<SandboxAdapter["runCommand"]>[0]) { return this.call("runCommand", () => this.delegate.runCommand(request)); }
  startPreview(request: Parameters<SandboxAdapter["startPreview"]>[0]) { return this.call("startPreview", () => this.delegate.startPreview(request)); }
  checkpoint(request: Parameters<SandboxAdapter["checkpoint"]>[0]) { return this.call("checkpoint", () => this.delegate.checkpoint(request)); }
  restore(request: Parameters<SandboxAdapter["restore"]>[0]) { return this.call("restore", () => this.delegate.restore(request)); }
  readLogs(request: Parameters<SandboxAdapter["readLogs"]>[0]) { return this.call("readLogs", () => this.delegate.readLogs(request)); }
  collectArtifact(request: Parameters<SandboxAdapter["collectArtifact"]>[0]) { return this.call("collectArtifact", () => this.delegate.collectArtifact(request)); }
  terminate(sandboxId: SandboxId) { return this.call("terminate", () => this.delegate.terminate(sandboxId)); }
}

describe("synthetic module lifecycle proof", () => {
  it("runs the approved sequence and returns normalized evidence", async () => {
    const tracking = new FaultAdapter(undefined);

    const evidence = await proveSyntheticModuleLifecycle(input(tracking));

    expect(tracking.calls).toEqual([
      "create", "writeFiles", "runCommand", "runCommand", "runCommand",
      "startPreview", "collectArtifact", "terminate",
    ]);
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      provider: "fault",
      tenantId: "tenant_example",
      workspaceId: "workspace_example",
      terminated: true,
      preview: { authenticated: true },
      artifact: { path: "workspace/app/dist/validation.json" },
    });
    expect(evidence.commands.map((command) => command.name)).toEqual(["install", "build", "test"]);
    expect(evidence.artifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it.each(["writeFiles", "runCommand", "startPreview", "collectArtifact"])(
    "terminates after a %s failure",
    async (failure) => {
      const tracking = new FaultAdapter(failure);

      await expect(proveSyntheticModuleLifecycle(input(tracking))).rejects.toThrow(`synthetic ${failure} failure`);
      expect(tracking.calls.at(-1)).toBe("terminate");
      expect(tracking.calls.filter((call) => call === "terminate")).toHaveLength(1);
    },
  );

  it("rejects missing capabilities before creating a workspace", async () => {
    const base = adapter().capabilities;
    const tracking = new FaultAdapter(undefined, { ...base, authenticatedPreviews: false });

    await expect(proveSyntheticModuleLifecycle(input(tracking))).rejects.toMatchObject({
      code: "unsupported",
      operation: "create",
    });
    expect(tracking.calls).toEqual([]);
  });

  it("rejects template bytes that do not match the approved digest before creating a workspace", async () => {
    const tracking = new FaultAdapter(undefined);
    const mismatched: ApprovedModuleTemplate = {
      ...SYNTHETIC_MODULE_TEMPLATE,
      files: () => {
        const files = SYNTHETIC_MODULE_TEMPLATE.files();
        const contents = files[0]!.contents;
        contents[0] = (contents[0] ?? 0) ^ 1;
        return files;
      },
    };

    await expect(proveSyntheticModuleLifecycle({ ...input(tracking), template: mismatched }))
      .rejects.toMatchObject({
        code: "policy_denied",
        operation: "create",
        message: "Sandbox template integrity check failed",
      });
    expect(tracking.calls).toEqual([]);
  });

  it("writes the byte snapshot that passed the template digest check", async () => {
    const source = new TextEncoder().encode("approved bytes");
    const approvedFiles = [{ path: "workspace/app/validation.json", contents: source }];
    const mutableRef = {
      id: "opentenant.snapshot-test",
      version: "1.0.0",
      digest: digestTemplateFiles(approvedFiles),
    };
    const approvedDigest = mutableRef.digest;
    const template: ApprovedModuleTemplate = {
      ref: mutableRef,
      files: () => approvedFiles,
      workingDirectory: "workspace/app",
      validationArtifactPath: "workspace/app/validation.json",
      previewPort: 3000,
    };
    class MutationAdapter extends InMemorySandboxAdapter {
      written: Uint8Array | undefined;
      createdDigest: string | undefined;

      constructor() {
        super({ commandExecutor: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
      }

      override async create(request: Parameters<SandboxAdapter["create"]>[0]) {
        this.createdDigest = request.template.digest;
        source.fill(0);
        mutableRef.digest = `sha256:${"0".repeat(64)}`;
        return super.create(request);
      }

      override async writeFiles(request: Parameters<SandboxAdapter["writeFiles"]>[0]) {
        this.written = Uint8Array.from(request.files[0]!.contents);
        return super.writeFiles(request);
      }
    }
    const mutationAdapter = new MutationAdapter();

    const evidence = await proveSyntheticModuleLifecycle({ ...input(mutationAdapter), template });

    expect(new TextDecoder().decode(mutationAdapter.written)).toBe("approved bytes");
    expect(mutationAdapter.createdDigest).toBe(approvedDigest);
    expect(evidence.template.digest).toBe(approvedDigest);
  });

  it("treats a non-zero command as failure and still terminates", async () => {
    class ExitAdapter extends InMemorySandboxAdapter {
      terminated = false;
      constructor() {
        super({ commandExecutor: async () => ({ exitCode: 1, stdout: "", stderr: "synthetic failure" }) });
      }
      override async terminate(sandboxId: SandboxId) {
        this.terminated = true;
        await super.terminate(sandboxId);
      }
    }
    const failing = new ExitAdapter();

    await expect(proveSyntheticModuleLifecycle(input(failing))).rejects.toMatchObject({
      code: "provider_failure",
      operation: "run_command",
    });
    expect(failing.terminated).toBe(true);
  });
});
