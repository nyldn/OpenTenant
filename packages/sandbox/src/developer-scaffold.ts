import { createHash } from "node:crypto";
import type { SandboxAdapter, SandboxLimits } from "./contracts";
import { digestTemplateFiles } from "./template";

const HTML = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Tenant module preview</title><h1>Tenant module</h1><p>Isolated module template, ready for development.</p></html>';
const files = () => [
  { path: "workspace/index.html", contents: new TextEncoder().encode(HTML) },
  { path: "workspace/module.mjs", contents: new TextEncoder().encode('export const manifest = { key: "tenant-example", runtime: "remote", version: "0.1.0" };\n') },
];
export const DEVELOPER_SERVICE_TEMPLATE = Object.freeze({ id: "opentenant/module-service@1", version: "1", digest: digestTemplateFiles(files()) });
export const DEVELOPER_SANDBOX_LIMITS: SandboxLimits = Object.freeze({ cpuCores: 1, memoryMb: 256, durationMs: 30_000, commandTimeoutMs: 5_000, commandOutputBytes: 1024, fileBytes: 16_384, fileCount: 8 });

/** Only synthetic template bytes enter the VM. Returns a static preview after teardown. */
export async function scaffoldDeveloperModule(adapter: SandboxAdapter, tenantId: string, workspaceId: string, signal?: AbortSignal): Promise<{ html: string; digest: string }> {
  if (!["microsandbox", "sandboxd"].includes(adapter.provider) || !adapter.capabilities.networkPolicy || !adapter.capabilities.resourceLimits || !adapter.capabilities.structuredCommands) throw new Error("Local isolated sandbox required");
  if (signal?.aborted) throw new Error("Sandbox authority expired");
  const workspace = await adapter.create({ tenantId, workspaceId, template: DEVELOPER_SERVICE_TEMPLATE, limits: DEVELOPER_SANDBOX_LIMITS, network: { mode: "deny_all", allowedHosts: [] } });
  let stopping: Promise<void> | undefined;
  const stop = () => { stopping ??= adapter.terminate(workspace.id); void stopping.catch(() => undefined); };
  signal?.addEventListener("abort", stop, { once: true });
  const active = () => { if (signal?.aborted) { stop(); throw new Error("Sandbox authority expired"); } };
  try {
    active();
    if (workspace.tenantId !== tenantId || workspace.workspaceId !== workspaceId) throw new Error("Sandbox binding mismatch");
    await adapter.writeFiles({ sandboxId: workspace.id, files: files() });
    active();
    const checked = await adapter.runCommand({ sandboxId: workspace.id, executable: "node", args: ["--check", "module.mjs"], cwd: "workspace", timeoutMs: 5000, outputLimitBytes: 1024 });
    if (checked.exitCode !== 0) throw new Error("Template validation failed");
    active();
    const artifact = await adapter.collectArtifact({ sandboxId: workspace.id, path: "workspace/index.html", maxBytes: 16_384 });
    // v1 previews contain only the approved static template. Never expose arbitrary VM output.
    if (new TextDecoder().decode(artifact.contents) !== HTML) throw new Error("Preview integrity mismatch");
    active();
    return { html: HTML, digest: createHash("sha256").update(HTML).digest("hex") };
  } finally { signal?.removeEventListener("abort", stop); if (stopping) await stopping; else await adapter.terminate(workspace.id); }
}
