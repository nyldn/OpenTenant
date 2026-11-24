import type { Sandbox, SandboxOpts } from "e2b";
import type { SandboxCreateRequest } from "../../contracts";
import { IsolatedSandboxAdapter, sandboxFailure, shellArg, type IsolatedInstance } from "../isolated";
import { approvedTemplate, type ProviderTemplate } from "../templates";

type Remote = Pick<Sandbox, "sandboxId" | "trafficAccessToken" | "commands" | "files" | "kill" | "getInfo" | "getHost">;
export interface E2bSdk { create(template: string, options: SandboxOpts): Promise<Remote> }
export interface E2bOptions {
  readonly provider?: string;
  readonly apiKey?: string;
  readonly templates: readonly ProviderTemplate[];
  readonly sdk?: E2bSdk;
  /** Must register a tenant-bound, expiring route and keep the upstream token server-side. */
  readonly protectPreview?: (input: { rawUrl: URL; token: string; tenantId: string; workspaceId: string; expiresAt: Date }) => Promise<URL>;
}

async function boundedCommand(remote: Remote, script: string, timeoutMs: number, limit: number, cwd?: string) {
  let stdout = "";
  let stderr = "";
  let remaining = limit + 1;
  const capture = (chunk: string, stream: "out" | "err") => {
    const part = Buffer.from(chunk).subarray(0, Math.max(0, remaining));
    remaining -= part.length;
    if (stream === "out") stdout += part.toString(); else stderr += part.toString();
  };
  const result = await remote.commands.run(script, { timeoutMs, requestTimeoutMs: timeoutMs + 5000, retainOutput: false, envs: {}, ...(cwd ? { cwd } : {}), onStdout: (data) => capture(data, "out"), onStderr: (data) => capture(data, "err") });
  return { exitCode: result.exitCode, stdout, stderr };
}

export class E2bSandboxAdapter extends IsolatedSandboxAdapter {
  constructor(options: E2bOptions) {
    super("e2b", { create: async (request) => createRemote(options, request) }, options.protectPreview !== undefined);
  }
}

async function createRemote(options: E2bOptions, request: SandboxCreateRequest): Promise<IsolatedInstance> {
  if (options.provider !== "e2b" || !options.apiKey?.trim()) throw sandboxFailure("create", "policy_denied");
  // Domain allowlists cannot guarantee connect-time private-address exclusion.
  if (request.network.mode !== "deny_all") throw sandboxFailure("create", "unsupported");
  const template = approvedTemplate(options.templates, request);
  const SandboxClass = options.sdk ? undefined : (await import("e2b")).Sandbox;
  const sdk: E2bSdk = options.sdk ?? { create: (template, config) => SandboxClass!.create(template, config) };
  const remote = await sdk.create(template.image, { apiKey: options.apiKey, envs: {}, metadata: {}, timeoutMs: request.limits.durationMs, requestTimeoutMs: 10_000, retries: 0, allowInternetAccess: false, network: { denyOut: ["0.0.0.0/0", "::/0"], allowOut: [], allowPublicTraffic: false } });
  try {
    const info = await remote.getInfo({ requestTimeoutMs: 10_000 });
    if (info.cpuCount !== request.limits.cpuCores || info.memoryMB !== request.limits.memoryMb
      || info.network?.allowPublicTraffic !== false || !Array.isArray(info.network.allowOut) || info.network.allowOut.length !== 0
      || !["0.0.0.0/0", "::/0"].every((cidr) => info.network?.denyOut?.includes(cidr))
      || !remote.trafficAccessToken) throw sandboxFailure("create", "unsupported");
    return {
      id: remote.sandboxId,
      write: async (path, contents) => { await remote.files.write(`/home/user/${path}`, Uint8Array.from(contents).buffer); },
      run: (command) => boundedCommand(remote, `/usr/bin/env -i HOME=/home/user PATH=/usr/local/bin:/usr/bin:/bin ${[command.executable, ...command.args].map(shellArg).join(" ")}`, command.timeoutMs, command.outputLimitBytes, `/home/user/${command.cwd}`),
      read: async (path, maxBytes) => {
        const result = await boundedCommand(remote, `head -c ${maxBytes + 1} -- ${shellArg(`/home/user/${path}`)} | base64`, request.limits.commandTimeoutMs, Math.ceil((maxBytes + 1) / 3) * 4 + Math.ceil(maxBytes / 50) + 16);
        if (result.exitCode !== 0 || result.stderr) throw sandboxFailure("collect_artifact");
        return Buffer.from(result.stdout, "base64");
      },
      ...(options.protectPreview ? { preview: async (port: number, path: string, expiresAt: Date) => {
        const rawUrl = new URL(`https://${remote.getHost(port)}`);
        rawUrl.pathname = path;
        const url = await options.protectPreview!({ rawUrl, token: remote.trafficAccessToken!, tenantId: request.tenantId, workspaceId: request.workspaceId, expiresAt });
        if (url.origin === rawUrl.origin) throw sandboxFailure("start_preview");
        return url;
      } } : {}),
      kill: async () => { await remote.kill({ requestTimeoutMs: 10_000 }); },
    };
  } catch (error) { await remote.kill({ requestTimeoutMs: 10_000 }); throw error; }
}
