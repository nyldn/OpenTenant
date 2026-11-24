import { vi } from "vitest";
import type { SandboxCreateRequest } from "../contracts";
import type { E2bSdk } from "../providers/e2b/adapter";
import type { MicrosandboxSdk } from "../providers/microsandbox/adapter";
import type { ProviderTemplate } from "../providers/templates";

export function vendorRequest(workspaceId = "workspace_test"): SandboxCreateRequest {
  return { tenantId: "tenant_test", workspaceId, template: { id: "fixture", version: "1", digest: `sha256:${"a".repeat(64)}` }, limits: { cpuCores: 1, memoryMb: 512, durationMs: 60_000, commandTimeoutMs: 10_000, commandOutputBytes: 1000, fileBytes: 1000, fileCount: 10 }, network: { mode: "deny_all", allowedHosts: [] } };
}
export const vendorTemplates: readonly ProviderTemplate[] = [{ ref: vendorRequest().template, image: "reviewed-local-image", cpuCores: 1, memoryMb: 512 }];

export function mockE2b() {
  let sequence = 0;
  const remotes: ReturnType<typeof remote>[] = [];
  function remote() {
    const files = new Map<string, Uint8Array>();
    return { sandboxId: `e2b_${++sequence}`, trafficAccessToken: "synthetic-preview-token", files: { write: vi.fn(async (path: string, contents: ArrayBuffer) => { files.set(path, new Uint8Array(contents)); }) },
      commands: { run: vi.fn(async (script: string, options: { onStdout: (data: string) => void }) => {
        if (script.startsWith("head -c")) { const path = script.match(/-- '([^']+)'/)![1]!; options.onStdout(Buffer.from(files.get(path) ?? []).toString("base64")); }
        else options.onStdout("abcdefghij");
        return { exitCode: 0 };
      }) },
      getInfo: vi.fn(async () => ({ cpuCount: 1, memoryMB: 512, network: { allowOut: [], denyOut: ["0.0.0.0/0", "::/0"], allowPublicTraffic: false } })),
      getHost: vi.fn(() => "3000-fixture.e2b.example.test"), kill: vi.fn(async () => true),
    };
  }
  const create = vi.fn(async () => { const instance = remote(); remotes.push(instance); return instance; });
  return { sdk: { create } as unknown as E2bSdk, create, remotes };
}

export function mockMicrosandbox() {
  const wait = vi.fn(async () => { throw new Error("exit event already consumed"); });
  const kill = vi.fn(async () => undefined);
  const creates: Array<Record<string, unknown>> = [];
  const setDefaultBackend = vi.fn();
  const builder = vi.fn(() => {
    const config: Record<string, unknown> = {};
    const files = new Map<string, Uint8Array>();
    const chain: Record<string, unknown> = {};
    for (const key of ["image", "pullPolicy", "cpus", "maxCpus", "memory", "maxMemory", "maxDuration", "disableNetwork", "envs", "ephemeral", "detached"]) chain[key] = (...args: unknown[]) => { config[key] = args.length ? args[0] : true; return chain; };
    chain.create = async () => {
      creates.push(config);
      return { id: `micro_${creates.length}`, backendKind: "local", killWithTimeout: kill, destroy: kill,
        fs: () => ({ write: async (path: string, contents: Uint8Array) => { files.set(path, contents); }, readStream: async (path: string) => ({ async *[Symbol.asyncIterator]() { yield files.get(path) ?? new Uint8Array(); }, [Symbol.asyncDispose]: async () => undefined }) }),
        execStreamWith: async () => ({ async *[Symbol.asyncIterator]() { yield { kind: "stdout", data: Buffer.from("abcdefghij") }; yield { kind: "exited", code: 0 }; }, wait, [Symbol.asyncDispose]: async () => undefined }),
      };
    };
    return chain;
  });
  return { sdk: { setDefaultBackend, Sandbox: { builder } } as unknown as MicrosandboxSdk, builder, setDefaultBackend, creates, kill, wait };
}
