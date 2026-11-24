import { createHash } from "node:crypto";
import type { SandboxAdapter, SandboxCapabilities, SandboxCreateRequest, SandboxWorkspace, SandboxId, SandboxOperation, SandboxWriteFilesRequest, SandboxCommandRequest, SandboxCommandResult, SandboxPreviewRequest, SandboxPreview, SandboxArtifactRequest, SandboxArtifact, SandboxCheckpointRequest, SandboxCheckpoint, SandboxRestoreRequest, SandboxLogRequest, SandboxLogs } from "../contracts";
import { sandboxCapabilities } from "../contracts";
import { SandboxError } from "../errors";
import { normalizeWorkspacePath, validateCreateRequest, validateWriteFilesRequest, validateCommandRequest, validatePreviewRequest } from "../policy";

/** Transport implementations must enforce isolation before returning a handle. */
export interface IsolatedInstance {
  readonly id: string;
  write(path: string, contents: Uint8Array): Promise<void>;
  run(request: SandboxCommandRequest): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  read(path: string, maxBytes: number): Promise<Uint8Array>;
  preview?(port: number, path: string, expiresAt: Date): Promise<URL>;
  kill(): Promise<void>;
}

export interface IsolatedClient {
  create(request: SandboxCreateRequest): Promise<IsolatedInstance>;
}

export function sandboxFailure(operation: SandboxOperation, code: "unsupported" | "policy_denied" | "provider_failure" = "provider_failure"): SandboxError {
  return new SandboxError({ code, operation, message: "Sandbox operation could not satisfy isolation policy" });
}

interface RecordEntry {
  readonly instance: IsolatedInstance;
  readonly request: SandboxCreateRequest;
  readonly workspace: SandboxWorkspace;
  readonly timer: ReturnType<typeof setTimeout>;
  terminated: boolean;
}

/** Shared policy and teardown for SDK-backed providers. Never exposes SDK errors. */
export class IsolatedSandboxAdapter implements SandboxAdapter {
  readonly capabilities: SandboxCapabilities;
  private readonly records = new Map<SandboxId, RecordEntry>();

  constructor(readonly provider: string, private readonly client: IsolatedClient, previews: boolean) {
    this.capabilities = sandboxCapabilities({ structuredCommands: true, previews, checkpoints: "none", processLogs: false, artifacts: true, resourceLimits: true, networkPolicy: true, authenticatedPreviews: previews, deterministicTeardown: true });
  }

  async create(input: SandboxCreateRequest): Promise<SandboxWorkspace> {
    const request = validateCreateRequest(input);
    let instance: IsolatedInstance | undefined;
    try {
      instance = await this.client.create(request);
      const createdAt = new Date();
      const workspace: SandboxWorkspace = { id: instance.id as SandboxId, provider: this.provider, tenantId: request.tenantId, workspaceId: request.workspaceId, status: "ready", createdAt, expiresAt: new Date(createdAt.getTime() + request.limits.durationMs) };
      if (!instance.id || this.records.has(workspace.id)) throw sandboxFailure("create");
      const timer = setTimeout(() => { void this.terminate(workspace.id).catch(() => { /* failed kills remain retryable via terminate */ }); }, request.limits.durationMs);
      timer.unref();
      this.records.set(workspace.id, { instance, request, workspace, timer, terminated: false });
      return workspace;
    } catch (error) {
      if (instance) {
        try { await instance.kill(); }
        catch { throw sandboxFailure("terminate"); }
      }
      throw error instanceof SandboxError ? error : sandboxFailure("create");
    }
  }

  async writeFiles(input: SandboxWriteFilesRequest): Promise<void> {
    return this.perform(input.sandboxId, "write_files", async (record) => {
      const request = validateWriteFilesRequest(input, record.request.limits);
      for (const file of request.files) await record.instance.write(file.path, Uint8Array.from(file.contents));
    });
  }

  async runCommand(input: SandboxCommandRequest): Promise<SandboxCommandResult> {
    return this.perform(input.sandboxId, "run_command", async (record) => {
      const request = validateCommandRequest(input, record.request.limits);
      const startedAt = new Date();
      const output = await record.instance.run(request);
      if (!Number.isInteger(output.exitCode)) throw sandboxFailure("run_command");
      const stdout = Buffer.from(output.stdout);
      const stderr = Buffer.from(output.stderr);
      const out = stdout.subarray(0, request.outputLimitBytes);
      const err = stderr.subarray(0, Math.max(0, request.outputLimitBytes - out.length));
      // Buffer.toString may add a replacement character at a split UTF-8 boundary.
      const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(bytes, { stream: true });
      const result = { exitCode: output.exitCode, stdout: decode(out), stderr: decode(err), outputTruncated: stdout.length + stderr.length > request.outputLimitBytes, startedAt, finishedAt: new Date() };
      if (output.exitCode !== 0) await this.terminate(input.sandboxId);
      return result;
    });
  }

  async startPreview(input: SandboxPreviewRequest): Promise<SandboxPreview> {
    return this.perform(input.sandboxId, "start_preview", async (record) => {
      const request = validatePreviewRequest(input);
      if (!record.instance.preview) throw sandboxFailure("start_preview", "unsupported");
      const expiresAt = new Date(Math.min(Date.now() + request.expiresInMs, record.workspace.expiresAt.getTime()));
      const url = await record.instance.preview(request.port, request.path, expiresAt);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw sandboxFailure("start_preview");
      return { url, expiresAt, authenticated: true };
    });
  }

  async collectArtifact(input: SandboxArtifactRequest): Promise<SandboxArtifact> {
    return this.perform(input.sandboxId, "collect_artifact", async (record) => {
      const path = normalizeWorkspacePath(input.path, "collect_artifact");
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0 || input.maxBytes > record.request.limits.fileBytes) throw sandboxFailure("collect_artifact", "policy_denied");
      const contents = Uint8Array.from(await record.instance.read(path, input.maxBytes));
      if (contents.length > input.maxBytes) throw sandboxFailure("collect_artifact", "policy_denied");
      return { path, contents, digest: `sha256:${createHash("sha256").update(contents).digest("hex")}` };
    });
  }

  async checkpoint(request: SandboxCheckpointRequest): Promise<SandboxCheckpoint> {
    return this.perform(request.sandboxId, "checkpoint", async () => { throw sandboxFailure("checkpoint", "unsupported"); });
  }
  async restore(_request: SandboxRestoreRequest): Promise<SandboxWorkspace> { throw sandboxFailure("restore", "unsupported"); }
  async readLogs(request: SandboxLogRequest): Promise<SandboxLogs> {
    return this.perform(request.sandboxId, "read_logs", async () => { throw sandboxFailure("read_logs", "unsupported"); });
  }

  async terminate(id: SandboxId): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new SandboxError({ code: "not_found", operation: "terminate", message: "Sandbox resource was not found" });
    if (record.terminated) return;
    try {
      await record.instance.kill();
      record.terminated = true;
      clearTimeout(record.timer);
    } catch { throw sandboxFailure("terminate"); }
  }

  private async perform<T>(id: SandboxId, operation: SandboxOperation, action: (record: RecordEntry) => Promise<T>): Promise<T> {
    const record = this.records.get(id);
    if (!record) throw new SandboxError({ code: "not_found", operation, message: "Sandbox resource was not found" });
    try {
      if (record.terminated || Date.now() >= record.workspace.expiresAt.getTime()) throw sandboxFailure(operation, "policy_denied");
      const remaining = record.workspace.expiresAt.getTime() - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const budget = operation === "run_command" ? record.request.limits.commandTimeoutMs + 5000 : 10_000;
        return await Promise.race([action(record), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new SandboxError({ code: "timeout", operation, message: "Sandbox operation exceeded its time budget" })), Math.min(remaining, budget));
        })]);
      } finally { if (timer) clearTimeout(timer); }
    } catch (error) {
      await this.terminate(id);
      throw error instanceof SandboxError ? error : sandboxFailure(operation);
    }
  }
}

/** Quote each argv element for SDKs whose process API accepts a shell string. */
export function shellArg(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
