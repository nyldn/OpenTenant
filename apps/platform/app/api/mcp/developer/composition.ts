import { identityGateway } from "../../../../lib/identity";
import type { UserId } from "@opentenant/auth";
import { DeveloperMcpStore } from "@opentenant/developer-mcp";
import type { MicrosandboxAdapter } from "@opentenant/sandbox/providers/microsandbox";
import type { SandboxCreateRequest } from "@opentenant/sandbox";
import { DEVELOPER_SERVICE_TEMPLATE, DEVELOPER_SANDBOX_LIMITS } from "@opentenant/sandbox";
import { controlPlanePool } from "../../../../lib/control-plane";
import { currentTenant } from "../../../../lib/tenant";
import { configurationEnvironment } from "../../../../lib/server-config";
import { developerMcpServerConfig } from "../server-config";

// The native provider must retain its installed SDK/runtime assets outside Next's
// bundle. The literal import remains visible to module and environment review.
const { MicrosandboxAdapter: NativeAdapter } = await import(/* webpackIgnore: true */ "@opentenant/sandbox/providers/microsandbox");

class DeveloperWorkspaceAdapter extends NativeAdapter {
  override async create(request: SandboxCreateRequest) {
    const workspace = await super.create(request);
    try {
      const prepared = await super.runCommand({ sandboxId: workspace.id, executable: "mkdir", args: ["-p", "/workspace"], cwd: "tmp", timeoutMs: 5000, outputLimitBytes: 1024 });
      if (prepared.exitCode !== 0) throw new Error("Developer workspace initialization failed");
      return workspace;
    } catch (error) { await super.terminate(workspace.id); throw error; }
  }
}

export function developerSandbox(env: Readonly<Record<string, string | undefined>> = configurationEnvironment()): MicrosandboxAdapter {
  const image = env.DEVELOPER_MCP_LOCAL_IMAGE;
  if (env.SANDBOX_PROVIDER !== "microsandbox" || !image || !/^[a-zA-Z0-9./:_-]+@sha256:[0-9a-f]{64}$/.test(image)) throw new Error("Local sandbox image is not configured");
  return new DeveloperWorkspaceAdapter({ provider: "microsandbox", templates: [{ ref: DEVELOPER_SERVICE_TEMPLATE, image, cpuCores: DEVELOPER_SANDBOX_LIMITS.cpuCores, memoryMb: DEVELOPER_SANDBOX_LIMITS.memoryMb }] });
}

export function developerRuntime() {
  return {
    config: developerMcpServerConfig(), store: new DeveloperMcpStore(controlPlanePool()),
    membershipActive: async (principal: { tenantId: string; userId: string }) => {
      const memberships = await identityGateway().listMemberships(principal.userId as UserId);
      return memberships.some((membership) => membership.tenantId === principal.tenantId && membership.userId === principal.userId && membership.status === "active");
    },
    tenant: async () => (await currentTenant())?.tenantId ?? null,
    sandbox: () => developerSandbox(),
  };
}
