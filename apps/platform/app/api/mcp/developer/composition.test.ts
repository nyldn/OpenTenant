import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/identity", () => ({ identityGateway: vi.fn() }));
vi.mock("../../../../lib/control-plane", () => ({ controlPlanePool: vi.fn() }));
vi.mock("../../../../lib/tenant", () => ({ currentTenant: vi.fn() }));
vi.mock("../../../../lib/server-config", () => ({ configurationEnvironment: () => ({}) }));
vi.mock("../server-config", () => ({ developerMcpServerConfig: vi.fn() }));

import { developerSandbox } from "./composition";
import { MicrosandboxAdapter } from "@opentenant/sandbox/providers/microsandbox";
import { DEVELOPER_SERVICE_TEMPLATE, DEVELOPER_SANDBOX_LIMITS, type SandboxWorkspace } from "@opentenant/sandbox";

afterEach(() => vi.restoreAllMocks());

describe("Developer MCP native sandbox composition", () => {
  const image = `node:22-bookworm@sha256:${"a".repeat(64)}`;
  it.each([
    {},
    { SANDBOX_PROVIDER: "e2b", DEVELOPER_MCP_LOCAL_IMAGE: image },
    { SANDBOX_PROVIDER: "microsandbox" },
    { SANDBOX_PROVIDER: "microsandbox", DEVELOPER_MCP_LOCAL_IMAGE: "node:latest" },
    { SANDBOX_PROVIDER: "microsandbox", DEVELOPER_MCP_LOCAL_IMAGE: "node@sha256:short" },
  ])("rejects unavailable, hosted and mutable runtime configuration", env => {
    expect(() => developerSandbox(env)).toThrow("Local sandbox image is not configured");
  });
  it("loads the installed native provider with the required isolation capabilities", () => {
    const adapter = developerSandbox({ SANDBOX_PROVIDER: "microsandbox", DEVELOPER_MCP_LOCAL_IMAGE: image });
    expect(adapter.provider).toBe("microsandbox");
    expect(adapter.capabilities).toMatchObject({ networkPolicy: true, structuredCommands: true, resourceLimits: true, deterministicTeardown: true });
  });
  it("destroys the VM when workspace initialization fails", async () => {
    const workspace: SandboxWorkspace = { id: "vm_route" as SandboxWorkspace["id"], provider: "microsandbox", tenantId: "tenant_route", workspaceId: "workspace_route", status: "ready", createdAt: new Date(), expiresAt: new Date(Date.now() + 30_000) };
    vi.spyOn(MicrosandboxAdapter.prototype, "create").mockResolvedValue(workspace);
    vi.spyOn(MicrosandboxAdapter.prototype, "runCommand").mockRejectedValue(new Error("Synthetic initialization failure"));
    const terminate = vi.spyOn(MicrosandboxAdapter.prototype, "terminate").mockResolvedValue();
    const adapter = developerSandbox({ SANDBOX_PROVIDER: "microsandbox", DEVELOPER_MCP_LOCAL_IMAGE: image });
    await expect(adapter.create({ tenantId: "tenant_route", workspaceId: "workspace_route", template: DEVELOPER_SERVICE_TEMPLATE, limits: DEVELOPER_SANDBOX_LIMITS, network: { mode: "deny_all", allowedHosts: [] } })).rejects.toThrow("Synthetic initialization failure");
    expect(terminate).toHaveBeenCalledExactlyOnceWith(workspace.id);
  });
});
