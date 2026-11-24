import { createHash } from "node:crypto";
import type {
  SandboxAdapter,
  SandboxArtifact,
  SandboxArtifactRequest,
  SandboxCheckpoint,
  SandboxCheckpointId,
  SandboxCheckpointRequest,
  SandboxCommandRequest,
  SandboxCommandResult,
  SandboxCreateRequest,
  SandboxId,
  SandboxLogRequest,
  SandboxLogs,
  SandboxPreview,
  SandboxPreviewRequest,
  SandboxRestoreRequest,
  SandboxStatus,
  SandboxTemplateRef,
  SandboxWorkspace,
  SandboxWriteFilesRequest,
} from "../../contracts";
import { sandboxCapabilities } from "../../contracts";
import { SandboxError } from "../../errors";
import {
  normalizeWorkspacePath,
  validateCreateRequest,
  validatePreviewRequest,
  validateWriteFilesRequest,
} from "../../policy";
import { SandboxdClient } from "./client";
import type { SandboxdSandbox } from "./types";

export interface SandboxdAdapterOptions {
  readonly client: SandboxdClient;
  readonly clock?: () => Date;
}

interface WorkspaceRecord {
  workspace: SandboxWorkspace;
  readonly request: SandboxCreateRequest;
  terminated: boolean;
}

interface CheckpointRecord {
  readonly tenantId: string;
  readonly remoteSnapshotId: string;
  readonly template: SandboxTemplateRef;
}

function status(status: SandboxdSandbox["status"]): SandboxStatus {
  if (status === "running") return "ready";
  if (status === "error") return "failed";
  return status;
}

export class SandboxdAdapter implements SandboxAdapter {
  readonly provider = "sandboxd";
  readonly capabilities = sandboxCapabilities({
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

  private readonly client: SandboxdClient;
  private readonly clock: () => Date;
  private readonly workspaces = new Map<SandboxId, WorkspaceRecord>();
  private readonly checkpoints = new Map<SandboxCheckpointId, CheckpointRecord>();

  constructor(options: SandboxdAdapterOptions) {
    this.client = options.client;
    this.clock = options.clock ?? (() => new Date());
  }

  async create(request: SandboxCreateRequest): Promise<SandboxWorkspace> {
    const validated = validateCreateRequest(request);
    const remote = await this.client.createSandbox({
      runtimePreset: validated.template.id,
      projectId: validated.workspaceId,
      userId: validated.tenantId,
    });
    return this.remember(remote, validated).workspace;
  }

  async writeFiles(request: SandboxWriteFilesRequest): Promise<void> {
    const record = this.active(request.sandboxId, "write_files");
    const validated = validateWriteFilesRequest(request, record.request.limits);
    for (const entry of validated.files) {
      await this.client.putFile(request.sandboxId, entry.path, entry.contents);
    }
  }

  async runCommand(_request: SandboxCommandRequest): Promise<SandboxCommandResult> {
    throw new SandboxError({
      code: "unsupported",
      operation: "run_command",
      message: "sandboxd does not expose bounded structured command execution",
    });
  }

  async startPreview(request: SandboxPreviewRequest): Promise<SandboxPreview> {
    const record = this.active(request.sandboxId, "start_preview");
    const validated = validatePreviewRequest(request);
    const remote = await this.client.getSandbox(request.sandboxId, "start_preview");
    if (
      remote.preview === undefined ||
      remote.preview.status !== "up" ||
      remote.preview.port !== validated.port
    ) {
      throw new SandboxError({
        code: "provider_failure",
        operation: "start_preview",
        message: "Sandbox preview is not ready",
      });
    }
    const url = new URL(remote.preview.url);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new SandboxError({
        code: "provider_failure",
        operation: "start_preview",
        message: "Sandbox provider returned an insecure preview URL",
      });
    }
    url.pathname = validated.path;
    return {
      url,
      authenticated: true,
      expiresAt: new Date(
        Math.min(this.clock().getTime() + validated.expiresInMs, record.workspace.expiresAt.getTime()),
      ),
    };
  }

  async checkpoint(request: SandboxCheckpointRequest): Promise<SandboxCheckpoint> {
    const record = this.active(request.sandboxId, "checkpoint");
    if (request.label.trim().length === 0 || /[\0\r\n]/u.test(request.label)) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "checkpoint",
        message: "Sandbox request violates workspace policy",
        details: { field: "label" },
      });
    }
    await this.client.stopSandbox(request.sandboxId);
    let remote;
    try {
      remote = await this.client.createSnapshot(request.sandboxId, request.label);
    } finally {
      await this.client.startSandbox(request.sandboxId);
    }
    const checkpoint: SandboxCheckpoint = {
      id: remote.id as SandboxCheckpointId,
      sandboxId: request.sandboxId,
      createdAt: remote.createdAt,
    };
    this.checkpoints.set(checkpoint.id, {
      tenantId: record.workspace.tenantId,
      remoteSnapshotId: remote.id,
      template: { ...record.request.template },
    });
    return checkpoint;
  }

  async restore(request: SandboxRestoreRequest): Promise<SandboxWorkspace> {
    const checkpoint = this.checkpoints.get(request.checkpointId);
    if (checkpoint === undefined) this.notFound("restore");
    if (checkpoint.tenantId !== request.tenantId) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "restore",
        message: "Checkpoint is not available to this tenant",
      });
    }
    const restoreRequest = validateCreateRequest({
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      template: checkpoint.template,
      limits: request.limits,
      network: request.network,
    });
    const remote = await this.client.createSandbox({
      fromSnapshot: checkpoint.remoteSnapshotId,
      projectId: request.workspaceId,
      userId: request.tenantId,
    });
    return this.remember(remote, restoreRequest).workspace;
  }

  async readLogs(request: SandboxLogRequest): Promise<SandboxLogs> {
    this.active(request.sandboxId, "read_logs");
    if (!Number.isInteger(request.tailLines) || request.tailLines <= 0 || request.tailLines > 1_000) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "read_logs",
        message: "Sandbox request violates workspace policy",
        details: { field: "tailLines" },
      });
    }
    const remote = await this.client.getProcessLogs(
      request.sandboxId,
      request.process,
      request.tailLines,
    );
    return { process: remote.process, lines: remote.lines, truncated: false };
  }

  async collectArtifact(request: SandboxArtifactRequest): Promise<SandboxArtifact> {
    this.active(request.sandboxId, "collect_artifact");
    const path = normalizeWorkspacePath(request.path, "collect_artifact");
    const prefix = "workspace/app/";
    if (!path.startsWith(prefix) || !Number.isInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "collect_artifact",
        message: "Sandbox request violates workspace policy",
        details: { field: path.startsWith(prefix) ? "maxBytes" : "path" },
      });
    }
    const contents = await this.client.getFile(request.sandboxId, path.slice(prefix.length));
    if (contents.byteLength > request.maxBytes) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "collect_artifact",
        message: "Sandbox artifact exceeds the requested limit",
        details: { field: "maxBytes" },
      });
    }
    return {
      path,
      contents,
      digest: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
    };
  }

  async terminate(sandboxId: SandboxId): Promise<void> {
    const record = this.workspaces.get(sandboxId);
    if (record === undefined) this.notFound("terminate");
    if (record.terminated) return;
    await this.client.deleteSandbox(sandboxId);
    record.terminated = true;
    record.workspace = { ...record.workspace, status: "terminated" };
  }

  private remember(remote: SandboxdSandbox, request: SandboxCreateRequest): WorkspaceRecord {
    const workspace: SandboxWorkspace = {
      id: remote.id as SandboxId,
      provider: this.provider,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      status: status(remote.status),
      createdAt: remote.createdAt,
      expiresAt: new Date(remote.createdAt.getTime() + request.limits.durationMs),
    };
    const record: WorkspaceRecord = { workspace, request, terminated: false };
    this.workspaces.set(workspace.id, record);
    return record;
  }

  private active(id: SandboxId, operation: "write_files" | "start_preview" | "checkpoint" | "read_logs" | "collect_artifact"): WorkspaceRecord {
    const record = this.workspaces.get(id);
    if (record === undefined) this.notFound(operation);
    if (record.terminated || this.clock().getTime() >= record.workspace.expiresAt.getTime()) {
      throw new SandboxError({
        code: "conflict",
        operation,
        message: "Sandbox workspace is not active",
      });
    }
    return record;
  }

  private notFound(operation: "restore" | "terminate" | "write_files" | "start_preview" | "checkpoint" | "read_logs" | "collect_artifact"): never {
    throw new SandboxError({
      code: "not_found",
      operation,
      message: "Sandbox resource was not found",
    });
  }
}
