import { randomUUID } from "node:crypto";
import type * as Microsandbox from "microsandbox";
import type { SandboxCreateRequest } from "../../contracts";
import { IsolatedSandboxAdapter, sandboxFailure, type IsolatedInstance } from "../isolated";
import { approvedTemplate, type ProviderTemplate } from "../templates";

export type MicrosandboxSdk = Pick<typeof Microsandbox, "Sandbox" | "setDefaultBackend">;
export interface MicrosandboxOptions {
  readonly provider?: string;
  readonly templates: readonly ProviderTemplate[];
  readonly sdk?: MicrosandboxSdk;
}

export class MicrosandboxAdapter extends IsolatedSandboxAdapter {
  constructor(options: MicrosandboxOptions) {
    super("microsandbox", { create: async (request) => createLocal(options, request) }, false);
  }
}

async function createLocal(options: MicrosandboxOptions, request: SandboxCreateRequest): Promise<IsolatedInstance> {
  if (options.provider !== "microsandbox") throw sandboxFailure("create", "policy_denied");
  if (request.network.mode !== "deny_all") throw sandboxFailure("create", "unsupported");
  const template = approvedTemplate(options.templates, request);
  const sdk = options.sdk ?? await import("microsandbox");
  // This SDK uses a process-wide backend. Composition must dedicate this worker
  // to local execution. Select local synchronously before building/creating.
  sdk.setDefaultBackend("local");
  const name = `opentenant-${randomUUID()}`;
  const builder = sdk.Sandbox.builder(name).image(template.image).pullPolicy("never")
    .cpus(request.limits.cpuCores).maxCpus(request.limits.cpuCores)
    .memory(request.limits.memoryMb).maxMemory(request.limits.memoryMb)
    .maxDuration(request.limits.durationMs / 1000).disableNetwork().envs({})
    .ephemeral(true).detached(false);
  let remote: Microsandbox.Sandbox;
  try { remote = await builder.create(); }
  catch {
    // A failed boot may have persisted a running VM under the generated name.
    const handle = await sdk.Sandbox.get(name).catch(() => undefined);
    if (handle) await handle.destroy({ force: true, timeoutMs: 10_000 });
    throw sandboxFailure("create");
  }
  try {
    if (remote.backendKind !== "local") throw sandboxFailure("create");
    return {
      id: remote.id,
      write: async (path, contents) => { await remote.fs().write(`/${path}`, contents); },
      run: async (command) => {
        const stream = await remote.execStreamWith("/usr/bin/env", (exec) => exec.args(["-i", "HOME=/tmp", "PATH=/usr/local/bin:/usr/bin:/bin", command.executable, ...command.args]).cwd(`/${command.cwd}`).envs({}).timeout(command.timeoutMs).stdinNull());
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let remaining = command.outputLimitBytes + 1;
        let exitCode: number | undefined;
        try {
          for await (const event of stream) {
            if (event.kind === "exited") exitCode = event.code;
            if (event.kind !== "stdout" && event.kind !== "stderr") continue;
            const part = Buffer.from(event.data).subarray(0, Math.max(0, remaining));
            remaining -= part.length;
            if (event.kind === "stdout") stdout = Buffer.concat([stdout, part]); else stderr = Buffer.concat([stderr, part]);
          }
          // The iterator consumes the exit event. A subsequent wait() cannot
          // recover it in the local 0.7.13 runtime.
          if (exitCode === undefined) throw sandboxFailure("run_command");
          return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
        } finally { await stream[Symbol.asyncDispose](); }
      },
      read: async (path, maxBytes) => {
        const stream = await remote.fs().readStream(`/${path}`);
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for await (const chunk of stream) {
            size += chunk.length;
            if (size > maxBytes) throw sandboxFailure("collect_artifact", "policy_denied");
            chunks.push(chunk);
          }
          return Buffer.concat(chunks);
        } finally { await stream[Symbol.asyncDispose](); }
      },
      kill: () => remote.destroy({ force: true, timeoutMs: 10_000 }),
    };
  } catch (error) { await remote.destroy({ force: true, timeoutMs: 10_000 }); throw error; }
}
