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
  SandboxOperation,
  SandboxPreview,
  SandboxPreviewRequest,
  SandboxRestoreRequest,
  SandboxTemplateRef,
  SandboxWorkspace,
  SandboxWriteFilesRequest,
} from "../../contracts";
import { sandboxCapabilities } from "../../contracts";
import { SandboxError, type SandboxErrorCode } from "../../errors";
import {
  normalizeWorkspacePath,
  validateCommandRequest,
  validateCreateRequest,
  validatePreviewRequest,
  validateWriteFilesRequest,
} from "../../policy";
import {
  VercelSandboxClientError,
  type VercelSandboxCreateInput,
  type VercelSandboxInstance,
  type VercelSandboxNetworkPolicy,
  type VercelSandboxProviderClient,
} from "./client";

export interface ProtectedPreviewInput {
  readonly rawUrl: URL;
  readonly sandboxId: SandboxId;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly expiresAt: Date;
}

export type ProtectVercelPreview = (input: ProtectedPreviewInput) => Promise<URL>;

export interface VercelSandboxAdapterOptions {
  readonly client: VercelSandboxProviderClient;
  readonly protectPreview?: ProtectVercelPreview;
  readonly clock?: () => Date;
}

interface WorkspaceRecord {
  workspace: SandboxWorkspace;
  readonly request: SandboxCreateRequest;
  readonly instance: VercelSandboxInstance;
  readonly ports: Set<number>;
  terminated: boolean;
}

interface CheckpointRecord {
  readonly tenantId: string;
  readonly snapshotId: string;
  readonly template: SandboxTemplateRef;
}

function networkPolicy(request: SandboxCreateRequest): VercelSandboxNetworkPolicy {
  return request.network.mode === "deny_all"
    ? "deny-all"
    : { allow: [...request.network.allowedHosts] };
}

function createInput(
  request: SandboxCreateRequest,
  snapshotId?: string,
): VercelSandboxCreateInput {
  const base = {
    runtime: "node22" as const,
    timeoutMs: request.limits.durationMs,
    vcpus: request.limits.cpuCores,
    networkPolicy: networkPolicy(request),
  };
  return snapshotId === undefined
    ? base
    : { ...base, source: { type: "snapshot", snapshotId } };
}

function clientErrorCode(error: VercelSandboxClientError): SandboxErrorCode {
  if (error.code === "not_found") return "not_found";
  if (error.code === "timeout") return "timeout";
  if (error.code === "rate_limited") return "rate_limited";
  if (error.code === "unavailable") return "provider_unavailable";
  if (error.code === "rejected") return "policy_denied";
  return "provider_failure";
}

function providerError(operation: SandboxOperation, error: unknown): SandboxError {
  if (error instanceof SandboxError) return error;
  return new SandboxError({
    code: error instanceof VercelSandboxClientError ? clientErrorCode(error) : "provider_failure",
    operation,
    message: "Sandbox provider operation failed",
  });
}

function truncateUtf8(value: string, limit: number): { value: string; bytes: number; truncated: boolean } {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= limit) {
    return { value, bytes: encoded.byteLength, truncated: false };
  }
  const result = new TextDecoder().decode(encoded.slice(0, limit));
  return { value: result, bytes: new TextEncoder().encode(result).byteLength, truncated: true };
}

function safeHttpsUrl(value: string | URL, operation: SandboxOperation): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SandboxError({
      code: "provider_failure",
      operation,
      message: "Sandbox provider returned an invalid URL",
    });
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new SandboxError({
      code: "provider_failure",
      operation,
      message: "Sandbox provider returned an insecure URL",
    });
  }
  return url;
}

function unsupported(operation: SandboxOperation, message: string): never {
  throw new SandboxError({ code: "unsupported", operation, message });
}

export class VercelSandboxAdapter implements SandboxAdapter {
  readonly provider = "vercel";
  readonly capabilities;

  private readonly client: VercelSandboxProviderClient;
  private readonly protectPreview: ProtectVercelPreview | undefined;
  private readonly clock: () => Date;
  private readonly workspaces = new Map<SandboxId, WorkspaceRecord>();
  private readonly checkpoints = new Map<SandboxCheckpointId, CheckpointRecord>();

  constructor(options: VercelSandboxAdapterOptions) {
    this.client = options.client;
    this.protectPreview = options.protectPreview;
    this.clock = options.clock ?? (() => new Date());
    this.capabilities = sandboxCapabilities({
      structuredCommands: true,
      previews: true,
      checkpoints: "fork",
      processLogs: false,
      artifacts: true,
      resourceLimits: false,
      networkPolicy: true,
      authenticatedPreviews: options.protectPreview !== undefined,
      deterministicTeardown: true,
    });
  }

  async create(request: SandboxCreateRequest): Promise<SandboxWorkspace> {
    const validated = validateCreateRequest(request);
    try {
      const instance = await this.client.create(createInput(validated));
      return this.remember(instance, validated).workspace;
    } catch (error) {
      throw providerError("create", error);
    }
  }

  async writeFiles(request: SandboxWriteFilesRequest): Promise<void> {
    const record = this.active(request.sandboxId, "write_files");
    const validated = validateWriteFilesRequest(request, record.request.limits);
    try {
      await record.instance.writeFiles(validated.files);
    } catch (error) {
      throw providerError("write_files", error);
    }
  }

  async runCommand(request: SandboxCommandRequest): Promise<SandboxCommandResult> {
    const record = this.active(request.sandboxId, "run_command");
    const validated = validateCommandRequest(request, record.request.limits);
    try {
      const output = await record.instance.runCommand({
        cmd: validated.executable,
        args: validated.args,
        cwd: validated.cwd,
        timeoutMs: validated.timeoutMs,
        outputLimitBytes: validated.outputLimitBytes,
      });
      const stdout = truncateUtf8(output.stdout, validated.outputLimitBytes);
      const stderr = truncateUtf8(
        output.stderr,
        Math.max(0, validated.outputLimitBytes - stdout.bytes),
      );
      const startedAt = output.startedAt ?? this.clock();
      const finishedAt = output.finishedAt ?? this.clock();
      return {
        exitCode: output.exitCode,
        stdout: stdout.value,
        stderr: stderr.value,
        startedAt: new Date(startedAt),
        finishedAt: new Date(finishedAt),
        outputTruncated: stdout.truncated || stderr.truncated,
      };
    } catch (error) {
      throw providerError("run_command", error);
    }
  }

  async startPreview(request: SandboxPreviewRequest): Promise<SandboxPreview> {
    if (this.protectPreview === undefined) {
      unsupported(
        "start_preview",
        "Vercel previews require an authenticated OpenTenant preview mediator",
      );
    }
    const record = this.active(request.sandboxId, "start_preview");
    const validated = validatePreviewRequest(request);
    const expiresAt = new Date(
      Math.min(
        this.clock().getTime() + validated.expiresInMs,
        record.workspace.expiresAt.getTime(),
      ),
    );
    try {
      record.ports.add(validated.port);
      await record.instance.updatePorts([...record.ports].sort((a, b) => a - b));
      const rawUrl = safeHttpsUrl(record.instance.domain(validated.port), "start_preview");
      rawUrl.pathname = validated.path;
      const protectedUrl = safeHttpsUrl(
        await this.protectPreview({
          rawUrl,
          sandboxId: request.sandboxId,
          tenantId: record.workspace.tenantId,
          workspaceId: record.workspace.workspaceId,
          expiresAt,
        }),
        "start_preview",
      );
      if (protectedUrl.origin === rawUrl.origin) {
        throw new SandboxError({
          code: "provider_failure",
          operation: "start_preview",
          message: "Preview mediator returned the unprotected provider origin",
        });
      }
      return { url: protectedUrl, expiresAt, authenticated: true };
    } catch (error) {
      throw providerError("start_preview", error);
    }
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
    try {
      const snapshot = await record.instance.snapshot({ label: request.label });
      record.terminated = true;
      record.workspace = { ...record.workspace, status: "terminated" };
      const checkpoint: SandboxCheckpoint = {
        id: snapshot.id as SandboxCheckpointId,
        sandboxId: request.sandboxId,
        createdAt: new Date(snapshot.createdAt ?? this.clock()),
      };
      this.checkpoints.set(checkpoint.id, {
        tenantId: record.workspace.tenantId,
        snapshotId: snapshot.id,
        template: { ...record.request.template },
      });
      return checkpoint;
    } catch (error) {
      throw providerError("checkpoint", error);
    }
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
    const validated = validateCreateRequest({
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      template: checkpoint.template,
      limits: request.limits,
      network: request.network,
    });
    try {
      const instance = await this.client.create(createInput(validated, checkpoint.snapshotId));
      return this.remember(instance, validated).workspace;
    } catch (error) {
      throw providerError("restore", error);
    }
  }

  async readLogs(_request: SandboxLogRequest): Promise<SandboxLogs> {
    unsupported(
      "read_logs",
      "The Vercel SDK boundary does not yet map named long-running process logs",
    );
  }

  async collectArtifact(request: SandboxArtifactRequest): Promise<SandboxArtifact> {
    const record = this.active(request.sandboxId, "collect_artifact");
    const path = normalizeWorkspacePath(request.path, "collect_artifact");
    if (!Number.isInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "collect_artifact",
        message: "Sandbox request violates workspace policy",
        details: { field: "maxBytes" },
      });
    }
    try {
      const contents = await record.instance.readFile(path, request.maxBytes);
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
    } catch (error) {
      throw providerError("collect_artifact", error);
    }
  }

  async terminate(sandboxId: SandboxId): Promise<void> {
    const record = this.workspaces.get(sandboxId);
    if (record === undefined) this.notFound("terminate");
    if (record.terminated) return;
    try {
      await record.instance.stop();
      record.terminated = true;
      record.workspace = { ...record.workspace, status: "terminated" };
    } catch (error) {
      throw providerError("terminate", error);
    }
  }

  private remember(instance: VercelSandboxInstance, request: SandboxCreateRequest): WorkspaceRecord {
    const createdAt = new Date(instance.createdAt ?? this.clock());
    const workspace: SandboxWorkspace = {
      id: instance.id as SandboxId,
      provider: this.provider,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      status: "ready",
      createdAt,
      expiresAt: new Date(createdAt.getTime() + request.limits.durationMs),
    };
    const record: WorkspaceRecord = {
      workspace,
      request,
      instance,
      ports: new Set(),
      terminated: false,
    };
    this.workspaces.set(workspace.id, record);
    return record;
  }

  private active(sandboxId: SandboxId, operation: SandboxOperation): WorkspaceRecord {
    const record = this.workspaces.get(sandboxId);
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

  private notFound(operation: SandboxOperation): never {
    throw new SandboxError({
      code: "not_found",
      operation,
      message: "Sandbox resource was not found",
    });
  }
}
