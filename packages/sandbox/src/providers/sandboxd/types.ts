export interface SandboxdPreview {
  readonly url: string;
  readonly port: number;
  readonly status: "starting" | "up" | "down" | "error";
}

export interface SandboxdSandbox {
  readonly id: string;
  readonly status: "creating" | "running" | "stopped" | "error";
  readonly template?: string;
  readonly preview?: SandboxdPreview;
  readonly createdAt: Date;
}

export interface SandboxdSnapshot {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

export interface SandboxdProcessLogs {
  readonly process: string;
  readonly lines: readonly string[];
}

export interface SandboxdCreateInput {
  readonly runtimePreset?: string;
  readonly fromSnapshot?: string;
  readonly projectId: string;
  readonly userId: string;
}
