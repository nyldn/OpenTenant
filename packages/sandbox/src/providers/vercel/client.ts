/**
 * Narrow provider seam for a future @vercel/sandbox SDK wrapper.
 *
 * The SDK and provider credentials deliberately stay outside the OpenTenant
 * sandbox contract. Tests inject a fake implementation of this interface.
 */

export type VercelSandboxNetworkPolicy = "deny-all" | { readonly allow: readonly string[] };

export interface VercelSandboxCreateInput {
  readonly runtime: "node22";
  readonly timeoutMs: number;
  readonly vcpus: number;
  readonly networkPolicy: VercelSandboxNetworkPolicy;
  readonly source?: {
    readonly type: "snapshot";
    readonly snapshotId: string;
  };
}

export interface VercelSandboxFile {
  readonly path: string;
  readonly contents: Uint8Array;
}

export interface VercelSandboxCommandInput {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
}

export interface VercelSandboxCommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
}

export interface VercelSandboxSnapshot {
  readonly id: string;
  readonly createdAt?: Date;
}

export interface VercelSandboxInstance {
  readonly id: string;
  readonly createdAt?: Date;
  writeFiles(files: readonly VercelSandboxFile[]): Promise<void>;
  runCommand(input: VercelSandboxCommandInput): Promise<VercelSandboxCommandOutput>;
  updatePorts(ports: readonly number[]): Promise<void>;
  domain(port: number): string;
  /** Vercel snapshots stop the source sandbox and restore as a new sandbox. */
  snapshot(input: { readonly label: string }): Promise<VercelSandboxSnapshot>;
  readFile(path: string, maxBytes: number): Promise<Uint8Array>;
  stop(): Promise<void>;
}

export interface VercelSandboxProviderClient {
  create(input: VercelSandboxCreateInput): Promise<VercelSandboxInstance>;
}

export type VercelSandboxClientErrorCode =
  | "not_found"
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "rejected"
  | "failure";

/** Error shape an SDK wrapper may use without exposing an upstream message. */
export class VercelSandboxClientError extends Error {
  readonly code: VercelSandboxClientErrorCode;

  constructor(code: VercelSandboxClientErrorCode, options: { readonly cause?: unknown } = {}) {
    super(
      "Vercel sandbox provider request failed",
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "VercelSandboxClientError";
    this.code = code;
  }
}
