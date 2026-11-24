import { describe, expect, it, vi } from "vitest";
import { E2bSandboxAdapter } from "./adapter";
import { configuredVendorSandbox } from "../configured";
import { mockE2b, vendorRequest, vendorTemplates } from "../../testing/vendor-fixtures";

describe("E2B isolation policy", () => {
  function setup() {
    const mock = mockE2b();
    const protectPreview = vi.fn(async () => new URL("https://preview.example.test/view"));
    const adapter = new E2bSandboxAdapter({ provider: "e2b", apiKey: "synthetic-key", templates: vendorTemplates, sdk: mock.sdk, protectPreview });
    return { mock, adapter, protectPreview };
  }
  it("is disabled without explicit provider and key configuration", async () => {
    const options = { e2b: { templates: vendorTemplates }, microsandbox: { templates: vendorTemplates } };
    expect(configuredVendorSandbox({}, options)).toBeUndefined();
    expect(configuredVendorSandbox({ SANDBOX_PROVIDER: "e2b" }, options)).toBeUndefined();
    const mock = mockE2b();
    await expect(new E2bSandboxAdapter({ templates: vendorTemplates, sdk: mock.sdk }).create(vendorRequest())).rejects.toMatchObject({ code: "policy_denied" });
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("maps deny-all networking, private ingress, empty guest env and bounded lifetime", async () => {
    const { adapter, mock } = setup();
    const workspace = await adapter.create(vendorRequest());
    expect(mock.create).toHaveBeenCalledWith("reviewed-local-image", expect.objectContaining({ apiKey: "synthetic-key", envs: {}, timeoutMs: 60_000, allowInternetAccess: false, network: { denyOut: ["0.0.0.0/0", "::/0"], allowOut: [], allowPublicTraffic: false } }));
    await adapter.terminate(workspace.id);
  });
  it("fails before allocation for unsupported allowlists and unknown templates", async () => {
    const { adapter, mock } = setup();
    await expect(adapter.create({ ...vendorRequest(), network: { mode: "allowlist", allowedHosts: ["example.test"] } })).rejects.toMatchObject({ code: "unsupported" });
    await expect(adapter.create({ ...vendorRequest(), template: { ...vendorRequest().template, version: "unapproved" } })).rejects.toMatchObject({ code: "policy_denied" });
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("kills a sandbox when policy readback is missing or resource limits differ", async () => {
    const { adapter, mock } = setup();
    const create = mock.create.getMockImplementation()!;
    mock.create.mockImplementation(async () => { const remote = await create(); remote.getInfo.mockResolvedValue({ cpuCount: 8, memoryMB: 512, network: { allowOut: [], denyOut: [], allowPublicTraffic: false } }); return remote; });
    await expect(adapter.create(vendorRequest())).rejects.toMatchObject({ code: "unsupported" });
    expect(mock.remotes[0]!.kill).toHaveBeenCalledOnce();
  });
  it("kills on errors and sanitizes SDK secrets", async () => {
    const { adapter, mock } = setup();
    const workspace = await adapter.create(vendorRequest());
    mock.remotes[0]!.commands.run.mockRejectedValue(new Error("credential=private"));
    const error = await adapter.runCommand({ sandboxId: workspace.id, executable: "node", args: [], cwd: "workspace/app", timeoutMs: 1000, outputLimitBytes: 100 }).catch((error: unknown) => error);
    expect(String(error)).not.toContain("private");
    expect(mock.remotes[0]!.kill).toHaveBeenCalledOnce();
    await expect(adapter.writeFiles({ sandboxId: workspace.id, files: [{ path: "late", contents: new Uint8Array() }] })).rejects.toThrow();
  });
  it("keeps preview tokens server-side and refuses the raw provider origin", async () => {
    const { adapter, mock, protectPreview } = setup();
    const workspace = await adapter.create(vendorRequest());
    protectPreview.mockImplementation(async () => new URL(`https://${mock.remotes[0]!.getHost()}`));
    await expect(adapter.startPreview({ sandboxId: workspace.id, port: 3000, path: "/", expiresInMs: 30_000 })).rejects.toMatchObject({ code: "provider_failure" });
    expect(protectPreview).toHaveBeenCalledWith(expect.objectContaining({ token: "synthetic-preview-token", tenantId: "tenant_test" }));
    expect(mock.remotes[0]!.kill).toHaveBeenCalledOnce();
  });
});
