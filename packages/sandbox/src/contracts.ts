export type SandboxId = string & { readonly __sandboxId: unique symbol };
export type SandboxCheckpointId = string & {
  readonly __sandboxCheckpointId: unique symbol;
};

export type SandboxStatus = "creating" | "ready" | "stopped" | "failed" | "terminated";

export type SandboxOperation =
  | "create"
  | "write_files"
  | "run_command"
  | "start_preview"
  | "checkpoint"
  | "restore"
  | "read_logs"
  | "collect_artifact"
  | "terminate";

export interface SandboxCapabilities {
  readonly structuredCommands: boolean;
  readonly previews: boolean;
  readonly checkpoints: "none" | "in_place" | "fork";
  readonly processLogs: boolean;
  readonly artifacts: boolean;
  readonly resourceLimits: boolean;
  readonly networkPolicy: boolean;
  readonly authenticatedPreviews: boolean;
  readonly deterministicTeardown: boolean;
}

export function sandboxCapabilities(capabilities: SandboxCapabilities): SandboxCapabilities {
  return Object.freeze({ ...capabilities });
}

export interface SandboxLimits {
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly durationMs: number;
  readonly commandTimeoutMs: number;
  readonly commandOutputBytes: number;
  readonly fileBytes: number;
  readonly fileCount: number;
}

export interface SandboxNetworkPolicy {
  readonly mode: "deny_all" | "allowlist";
  readonly allowedHosts: readonly string[];
}

export interface SandboxTemplateRef {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export interface SandboxCreateRequest {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly template: SandboxTemplateRef;
  readonly limits: SandboxLimits;
  readonly network: SandboxNetworkPolicy;
}

export interface SandboxWorkspace {
  readonly id: SandboxId;
  readonly provider: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly status: SandboxStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface SandboxFileWrite {
  readonly path: string;
  readonly contents: Uint8Array;
}

export interface SandboxWriteFilesRequest {
  readonly sandboxId: SandboxId;
  readonly files: readonly SandboxFileWrite[];
}

export interface SandboxCommandRequest {
  readonly sandboxId: SandboxId;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
}

export interface SandboxCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly outputTruncated: boolean;
}

export interface SandboxPreviewRequest {
  readonly sandboxId: SandboxId;
  readonly port: number;
  readonly path: string;
  readonly expiresInMs: number;
}

export interface SandboxPreview {
  readonly url: URL;
  readonly expiresAt: Date;
  readonly authenticated: boolean;
}

export interface SandboxCheckpointRequest {
  readonly sandboxId: SandboxId;
  readonly label: string;
}

export interface SandboxCheckpoint {
  readonly id: SandboxCheckpointId;
  readonly sandboxId: SandboxId;
  readonly createdAt: Date;
}

export interface SandboxRestoreRequest {
  readonly checkpointId: SandboxCheckpointId;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly limits: SandboxLimits;
  readonly network: SandboxNetworkPolicy;
}

export interface SandboxLogRequest {
  readonly sandboxId: SandboxId;
  readonly process: string;
  readonly tailLines: number;
}

export interface SandboxLogs {
  readonly process: string;
  readonly lines: readonly string[];
  readonly truncated: boolean;
}

export interface SandboxArtifactRequest {
  readonly sandboxId: SandboxId;
  readonly path: string;
  readonly maxBytes: number;
}

export interface SandboxArtifact {
  readonly path: string;
  readonly contents: Uint8Array;
  readonly digest: string;
}

export interface SandboxAdapter {
  readonly provider: string;
  readonly capabilities: SandboxCapabilities;
  create(request: SandboxCreateRequest): Promise<SandboxWorkspace>;
  writeFiles(request: SandboxWriteFilesRequest): Promise<void>;
  runCommand(request: SandboxCommandRequest): Promise<SandboxCommandResult>;
  startPreview(request: SandboxPreviewRequest): Promise<SandboxPreview>;
  checkpoint(request: SandboxCheckpointRequest): Promise<SandboxCheckpoint>;
  restore(request: SandboxRestoreRequest): Promise<SandboxWorkspace>;
  readLogs(request: SandboxLogRequest): Promise<SandboxLogs>;
  collectArtifact(request: SandboxArtifactRequest): Promise<SandboxArtifact>;
  terminate(sandboxId: SandboxId): Promise<void>;
}
