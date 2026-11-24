import { createHash } from "node:crypto";
import type {
  SandboxAdapter,
  SandboxArtifact,
  SandboxArtifactRequest,
  SandboxCapabilities,
  SandboxCheckpoint,
  SandboxCheckpointId,
  SandboxCheckpointRequest,
  SandboxCommandRequest,
  SandboxCommandResult,
  SandboxCreateRequest,
  SandboxId,
  SandboxLimits,
  SandboxLogRequest,
  SandboxLogs,
  SandboxOperation,
  SandboxPreview,
  SandboxPreviewRequest,
  SandboxRestoreRequest,
  SandboxTemplateRef,
  SandboxWorkspace,
  SandboxWriteFilesRequest,
} from "../contracts";
import { sandboxCapabilities } from "../contracts";
import { SandboxError } from "../errors";
import {
  normalizeWorkspacePath,
  validateCommandRequest,
  validateCreateRequest,
  validatePreviewRequest,
  validateWriteFilesRequest,
} from "../policy";

export interface InMemoryCommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface InMemorySandboxAdapterOptions {
  readonly clock?: () => Date;
  readonly nextId?: (kind: "sandbox" | "checkpoint") => string;
  readonly commandExecutor?: (
    request: SandboxCommandRequest,
    files: ReadonlyMap<string, Uint8Array>,
  ) => Promise<InMemoryCommandOutput>;
  readonly capabilities?: SandboxCapabilities;
  readonly previewDomain?: string;
}

interface WorkspaceRecord {
  workspace: SandboxWorkspace;
  readonly limits: SandboxLimits;
  readonly template: SandboxTemplateRef;
  readonly files: Map<string, Uint8Array>;
  readonly logs: Map<string, string[]>;
}

interface CheckpointRecord {
  readonly checkpoint: SandboxCheckpoint;
  readonly tenantId: string;
  readonly template: SandboxTemplateRef;
  readonly files: Map<string, Uint8Array>;
}

const DEFAULT_CAPABILITIES = sandboxCapabilities({
  structuredCommands: true,
  previews: true,
  checkpoints: "fork",
  processLogs: true,
  artifacts: true,
  resourceLimits: true,
  networkPolicy: true,
  authenticatedPreviews: true,
  deterministicTeardown: true,
});

function copyFiles(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map([...files].map(([path, contents]) => [path, contents.slice()]));
}

function unsupported(operation: SandboxOperation): never {
  throw new SandboxError({
    code: "unsupported",
    operation,
    message: "Sandbox provider does not support this operation",
  });
}

function truncateUtf8(value: string, limit: number): { value: string; truncated: boolean } {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= limit) {
    return { value, truncated: false };
  }
  return {
    value: new TextDecoder().decode(encoded.slice(0, limit)),
    truncated: true,
  };
}

export class InMemorySandboxAdapter implements SandboxAdapter {
  readonly provider = "memory";
  readonly capabilities: SandboxCapabilities;

  private readonly clock: () => Date;
  private readonly nextId: (kind: "sandbox" | "checkpoint") => string;
  private readonly commandExecutor?: InMemorySandboxAdapterOptions["commandExecutor"];
  private readonly previewDomain: string;
  private readonly workspaces = new Map<SandboxId, WorkspaceRecord>();
  private readonly checkpoints = new Map<SandboxCheckpointId, CheckpointRecord>();

  constructor(options: InMemorySandboxAdapterOptions = {}) {
    let sequence = 0;
    this.clock = options.clock ?? (() => new Date());
    this.nextId = options.nextId ?? ((kind) => `${kind}_${++sequence}`);
    this.commandExecutor = options.commandExecutor;
    this.capabilities = sandboxCapabilities(options.capabilities ?? DEFAULT_CAPABILITIES);
    this.previewDomain = options.previewDomain ?? "preview.example.test";
  }

  async create(request: SandboxCreateRequest): Promise<SandboxWorkspace> {
    const validated = validateCreateRequest(request);
    return this.createRecord(validated, new Map()).workspace;
  }

  async writeFiles(request: SandboxWriteFilesRequest): Promise<void> {
    const record = this.activeWorkspace(request.sandboxId, "write_files");
    const validated = validateWriteFilesRequest(request, record.limits);
    for (const entry of validated.files) {
      record.files.set(entry.path, entry.contents.slice());
    }
  }

  async runCommand(request: SandboxCommandRequest): Promise<SandboxCommandResult> {
    if (!this.capabilities.structuredCommands) {
      unsupported("run_command");
    }
    const record = this.activeWorkspace(request.sandboxId, "run_command");
    const validated = validateCommandRequest(request, record.limits);
    if (this.commandExecutor === undefined) {
      throw new SandboxError({
        code: "provider_failure",
        operation: "run_command",
        message: "Sandbox command executor is not configured",
      });
    }

    const startedAt = new Date(this.clock());
    const output = await this.commandExecutor(validated, copyFiles(record.files));
    const finishedAt = new Date(this.clock());
    const stdout = truncateUtf8(output.stdout, validated.outputLimitBytes);
    const remainingBytes = Math.max(
      0,
      validated.outputLimitBytes - new TextEncoder().encode(stdout.value).byteLength,
    );
    const stderr = truncateUtf8(output.stderr, remainingBytes);
    record.logs.set(validated.executable, [
      ...output.stdout.split(/\r?\n/u),
      ...output.stderr.split(/\r?\n/u),
    ].filter((line) => line.length > 0));

    return {
      exitCode: output.exitCode,
      stdout: stdout.value,
      stderr: stderr.value,
      startedAt,
      finishedAt,
      outputTruncated: stdout.truncated || stderr.truncated,
    };
  }

  async startPreview(request: SandboxPreviewRequest): Promise<SandboxPreview> {
    if (!this.capabilities.previews) {
      unsupported("start_preview");
    }
    const record = this.activeWorkspace(request.sandboxId, "start_preview");
    const validated = validatePreviewRequest(request);
    const requestedExpiry = this.clock().getTime() + validated.expiresInMs;
    const expiresAt = new Date(Math.min(requestedExpiry, record.workspace.expiresAt.getTime()));
    return {
      url: new URL(
        `https://${encodeURIComponent(record.workspace.id)}.${this.previewDomain}${validated.path}`,
      ),
      expiresAt,
      authenticated: true,
    };
  }

  async checkpoint(request: SandboxCheckpointRequest): Promise<SandboxCheckpoint> {
    if (this.capabilities.checkpoints === "none") {
      unsupported("checkpoint");
    }
    const record = this.activeWorkspace(request.sandboxId, "checkpoint");
    if (request.label.trim().length === 0 || /[\0\r\n]/u.test(request.label)) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "checkpoint",
        message: "Sandbox request violates workspace policy",
        details: { field: "label" },
      });
    }
    const checkpoint: SandboxCheckpoint = {
      id: this.nextId("checkpoint") as SandboxCheckpointId,
      sandboxId: request.sandboxId,
      createdAt: new Date(this.clock()),
    };
    this.checkpoints.set(checkpoint.id, {
      checkpoint,
      tenantId: record.workspace.tenantId,
      template: record.template,
      files: copyFiles(record.files),
    });
    return checkpoint;
  }

  async restore(request: SandboxRestoreRequest): Promise<SandboxWorkspace> {
    if (this.capabilities.checkpoints === "none") {
      unsupported("restore");
    }
    const snapshot = this.checkpoints.get(request.checkpointId);
    if (snapshot === undefined) {
      this.notFound("restore");
    }
    if (snapshot.tenantId !== request.tenantId) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "restore",
        message: "Checkpoint is not available to this tenant",
      });
    }
    const validated = validateCreateRequest({
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      template: snapshot.template,
      limits: request.limits,
      network: request.network,
    });
    return this.createRecord(validated, copyFiles(snapshot.files)).workspace;
  }

  async readLogs(request: SandboxLogRequest): Promise<SandboxLogs> {
    if (!this.capabilities.processLogs) {
      unsupported("read_logs");
    }
    const record = this.activeWorkspace(request.sandboxId, "read_logs");
    if (!Number.isInteger(request.tailLines) || request.tailLines <= 0 || request.tailLines > 1_000) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "read_logs",
        message: "Sandbox request violates workspace policy",
        details: { field: "tailLines" },
      });
    }
    const lines = record.logs.get(request.process) ?? [];
    return {
      process: request.process,
      lines: lines.slice(-request.tailLines),
      truncated: lines.length > request.tailLines,
    };
  }

  async collectArtifact(request: SandboxArtifactRequest): Promise<SandboxArtifact> {
    if (!this.capabilities.artifacts) {
      unsupported("collect_artifact");
    }
    const record = this.activeWorkspace(request.sandboxId, "collect_artifact");
    const path = normalizeWorkspacePath(request.path, "collect_artifact");
    if (!Number.isInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "collect_artifact",
        message: "Sandbox request violates workspace policy",
        details: { field: "maxBytes" },
      });
    }
    const contents = record.files.get(path);
    if (contents === undefined) {
      this.notFound("collect_artifact");
    }
    if (contents.byteLength > request.maxBytes) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "collect_artifact",
        message: "Sandbox artifact exceeds the requested limit",
        details: { field: "maxBytes" },
      });
    }
    const copy = contents.slice();
    return {
      path,
      contents: copy,
      digest: `sha256:${createHash("sha256").update(copy).digest("hex")}`,
    };
  }

  async terminate(sandboxId: SandboxId): Promise<void> {
    const record = this.workspaces.get(sandboxId);
    if (record === undefined) {
      this.notFound("terminate");
    }
    if (record.workspace.status === "terminated") {
      return;
    }
    record.workspace = { ...record.workspace, status: "terminated" };
    record.files.clear();
    record.logs.clear();
  }

  private createRecord(
    request: SandboxCreateRequest,
    files: Map<string, Uint8Array>,
  ): WorkspaceRecord {
    const createdAt = new Date(this.clock());
    const workspace: SandboxWorkspace = {
      id: this.nextId("sandbox") as SandboxId,
      provider: this.provider,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      status: "ready",
      createdAt,
      expiresAt: new Date(createdAt.getTime() + request.limits.durationMs),
    };
    const record: WorkspaceRecord = {
      workspace,
      limits: { ...request.limits },
      template: { ...request.template },
      files,
      logs: new Map(),
    };
    this.workspaces.set(workspace.id, record);
    return record;
  }

  private activeWorkspace(sandboxId: SandboxId, operation: SandboxOperation): WorkspaceRecord {
    const record = this.workspaces.get(sandboxId);
    if (record === undefined) {
      this.notFound(operation);
    }
    if (record.workspace.status === "terminated") {
      throw new SandboxError({
        code: "conflict",
        operation,
        message: "Sandbox workspace has been terminated",
      });
    }
    if (this.clock().getTime() >= record.workspace.expiresAt.getTime()) {
      record.workspace = { ...record.workspace, status: "terminated" };
      record.files.clear();
      record.logs.clear();
      throw new SandboxError({
        code: "conflict",
        operation,
        message: "Sandbox workspace has expired",
      });
    }
    return record;
  }

  private notFound(operation: SandboxOperation): never {
    throw new SandboxError({
      code: "not_found",
      operation,
      message: "Sandbox resource was not found",
    });
  }
}
