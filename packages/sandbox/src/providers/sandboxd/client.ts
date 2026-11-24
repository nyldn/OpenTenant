import type { SandboxOperation } from "../../contracts";
import { SandboxError, type SandboxErrorCode } from "../../errors";
import type {
  SandboxdCreateInput,
  SandboxdProcessLogs,
  SandboxdSandbox,
  SandboxdSnapshot,
} from "./types";

export interface SandboxdClientOptions {
  readonly baseUrl: string;
  readonly bearerToken?: string;
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseSandbox(value: unknown): SandboxdSandbox | undefined {
  if (!isRecord(value) || typeof value.id !== "string") {
    return undefined;
  }
  if (!["creating", "running", "stopped", "error"].includes(String(value.status))) {
    return undefined;
  }
  const createdAt = parseDate(value.created_at);
  if (createdAt === undefined) {
    return undefined;
  }

  let preview: SandboxdSandbox["preview"];
  if (value.preview !== undefined && value.preview !== null) {
    if (
      !isRecord(value.preview) ||
      typeof value.preview.url !== "string" ||
      typeof value.preview.port !== "number" ||
      !["starting", "up", "down", "error"].includes(String(value.preview.status))
    ) {
      return undefined;
    }
    preview = {
      url: value.preview.url,
      port: value.preview.port,
      status: value.preview.status as SandboxdSandbox["preview"] extends infer Preview
        ? Preview extends { status: infer Status }
          ? Status
          : never
        : never,
    };
  }

  const sandbox: SandboxdSandbox = {
    id: value.id,
    status: value.status as SandboxdSandbox["status"],
    createdAt,
  };
  if (typeof value.template === "string") {
    Object.assign(sandbox, { template: value.template });
  }
  if (preview !== undefined) {
    Object.assign(sandbox, { preview });
  }
  return sandbox;
}

function parseSnapshot(value: unknown): SandboxdSnapshot | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return undefined;
  }
  const createdAt = parseDate(value.created_at);
  return createdAt === undefined ? undefined : { id: value.id, name: value.name, createdAt };
}

function parseLogs(value: unknown): SandboxdProcessLogs | undefined {
  if (
    !isRecord(value) ||
    typeof value.process !== "string" ||
    !Array.isArray(value.lines) ||
    value.lines.some((line) => typeof line !== "string")
  ) {
    return undefined;
  }
  return { process: value.process, lines: value.lines as string[] };
}

function statusCode(status: number): SandboxErrorCode {
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status === 400 || status === 401 || status === 403 || status === 413) {
    return "policy_denied";
  }
  return "provider_failure";
}

export class SandboxdClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: SandboxdClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    const isLocalHttp =
      baseUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
    if (baseUrl.protocol !== "https:" && !isLocalHttp) {
      throw new SandboxError({
        code: "policy_denied",
        operation: "create",
        message: "Sandbox provider URL must use HTTPS",
        details: { field: "baseUrl" },
      });
    }
    if (baseUrl.username !== "" || baseUrl.password !== "" || baseUrl.search !== "") {
      throw new SandboxError({
        code: "policy_denied",
        operation: "create",
        message: "Sandbox provider URL must not contain credentials or query parameters",
        details: { field: "baseUrl" },
      });
    }
    const pathname = baseUrl.pathname === "/" ? "" : baseUrl.pathname.replace(/\/$/u, "");
    this.baseUrl = `${baseUrl.origin}${pathname}`;
    this.bearerToken = options.bearerToken;
    this.fetcher = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  async createSandbox(input: SandboxdCreateInput): Promise<SandboxdSandbox> {
    const body: JsonRecord = {
      visibility: "private",
      project: { id: input.projectId, user_id: input.userId },
    };
    if (input.runtimePreset !== undefined) body.runtime_preset = input.runtimePreset;
    if (input.fromSnapshot !== undefined) body.from_snapshot = input.fromSnapshot;
    const value = await this.jsonRequest("/v1/sandboxes", "create", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return this.requireShape(parseSandbox(value), "create");
  }

  async getSandbox(id: string, operation: SandboxOperation = "create"): Promise<SandboxdSandbox> {
    const value = await this.jsonRequest(`/v1/sandboxes/${encodeURIComponent(id)}`, operation);
    return this.requireShape(parseSandbox(value), operation);
  }

  async putFile(id: string, path: string, contents: Uint8Array): Promise<void> {
    const query = new URLSearchParams({ path });
    await this.emptyRequest(
      `/v1/sandboxes/${encodeURIComponent(id)}/files?${query.toString()}`,
      "write_files",
      { method: "PUT", body: Uint8Array.from(contents).buffer },
    );
  }

  async getFile(id: string, appRelativePath: string): Promise<Uint8Array> {
    const query = new URLSearchParams({ path: appRelativePath });
    const response = await this.request(
      `/v1/sandboxes/${encodeURIComponent(id)}/files/content?${query.toString()}`,
      "collect_artifact",
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async stopSandbox(id: string): Promise<SandboxdSandbox> {
    const value = await this.jsonRequest(
      `/v1/sandboxes/${encodeURIComponent(id)}/stop`,
      "checkpoint",
      { method: "POST" },
    );
    return this.requireShape(parseSandbox(value), "checkpoint");
  }

  async startSandbox(id: string): Promise<SandboxdSandbox> {
    const value = await this.jsonRequest(
      `/v1/sandboxes/${encodeURIComponent(id)}/start`,
      "checkpoint",
      { method: "POST" },
    );
    return this.requireShape(parseSandbox(value), "checkpoint");
  }

  async createSnapshot(id: string, name: string): Promise<SandboxdSnapshot> {
    const value = await this.jsonRequest("/v1/snapshots", "checkpoint", {
      method: "POST",
      body: JSON.stringify({ source_sandbox_id: id, name }),
    });
    return this.requireShape(parseSnapshot(value), "checkpoint");
  }

  async getProcessLogs(id: string, processName: string, tail: number): Promise<SandboxdProcessLogs> {
    const query = new URLSearchParams({ tail: String(tail) });
    const value = await this.jsonRequest(
      `/v1/sandboxes/${encodeURIComponent(id)}/processes/${encodeURIComponent(processName)}/logs?${query.toString()}`,
      "read_logs",
    );
    return this.requireShape(parseLogs(value), "read_logs");
  }

  async deleteSandbox(id: string): Promise<void> {
    await this.emptyRequest(`/v1/sandboxes/${encodeURIComponent(id)}`, "terminate", {
      method: "DELETE",
    });
  }

  private async jsonRequest(
    path: string,
    operation: SandboxOperation,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.request(path, operation, init);
    try {
      return await response.json();
    } catch {
      throw new SandboxError({
        code: "provider_failure",
        operation,
        message: "Sandbox provider returned an invalid response",
      });
    }
  }

  private async emptyRequest(
    path: string,
    operation: SandboxOperation,
    init: RequestInit,
  ): Promise<void> {
    await this.request(path, operation, init);
  }

  private async request(
    path: string,
    operation: SandboxOperation,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.bearerToken !== undefined) headers.authorization = `Bearer ${this.bearerToken}`;
    if (typeof init.body === "string") headers["content-type"] = "application/json";
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!response.ok) {
        throw new SandboxError({
          code: statusCode(response.status),
          operation,
          message: "Sandbox provider rejected the operation",
          details: { status: response.status },
        });
      }
      return response;
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError({
        code: "provider_unavailable",
        operation,
        message: "Sandbox provider is unavailable",
      });
    }
  }

  private requireShape<T>(value: T | undefined, operation: SandboxOperation): T {
    if (value === undefined) {
      throw new SandboxError({
        code: "provider_failure",
        operation,
        message: "Sandbox provider returned an invalid response",
      });
    }
    return value;
  }
}
