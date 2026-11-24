import { describe, expect, it } from "vitest";
import { MicrosandboxAdapter } from "./adapter";
import { mockMicrosandbox, vendorRequest, vendorTemplates } from "../../testing/vendor-fixtures";

describe("microsandbox isolation policy", () => {
  it("pins local execution, cached images, no network and enforced resource limits", async () => {
    const mock = mockMicrosandbox();
    const adapter = new MicrosandboxAdapter({ provider: "microsandbox", templates: vendorTemplates, sdk: mock.sdk });
    const workspace = await adapter.create(vendorRequest());
    expect(mock.setDefaultBackend).toHaveBeenCalledWith("local");
    expect(mock.creates[0]).toEqual({ image: "reviewed-local-image", pullPolicy: "never", cpus: 1, maxCpus: 1, memory: 512, maxMemory: 512, maxDuration: 60, disableNetwork: true, envs: {}, ephemeral: true, detached: false });
    await expect(adapter.startPreview({ sandboxId: workspace.id, port: 3000, path: "/", expiresInMs: 1000 })).rejects.toMatchObject({ code: "unsupported" });
    expect(mock.kill).toHaveBeenCalledOnce();
  });
  it("uses the streamed exit status and destroys the persisted VM on termination", async () => {
    const mock = mockMicrosandbox();
    const adapter = new MicrosandboxAdapter({ provider: "microsandbox", templates: vendorTemplates, sdk: mock.sdk });
    const workspace = await adapter.create(vendorRequest());
    expect(await adapter.runCommand({ sandboxId: workspace.id, executable: "/bin/echo", args: [], cwd: "tmp", timeoutMs: 1000, outputLimitBytes: 5 })).toMatchObject({ exitCode: 0, stdout: "abcde", outputTruncated: true });
    expect(mock.wait).not.toHaveBeenCalled();
    expect(mock.kill).not.toHaveBeenCalled();
    await adapter.terminate(workspace.id);
    expect(mock.kill).toHaveBeenCalledWith({ force: true, timeoutMs: 10_000 });
  });
  it("refuses disabled configuration and allowlists before touching the runtime", async () => {
    const mock = mockMicrosandbox();
    await expect(new MicrosandboxAdapter({ templates: vendorTemplates, sdk: mock.sdk }).create(vendorRequest())).rejects.toMatchObject({ code: "policy_denied" });
    await expect(new MicrosandboxAdapter({ provider: "microsandbox", templates: vendorTemplates, sdk: mock.sdk }).create({ ...vendorRequest(), network: { mode: "allowlist", allowedHosts: ["example.test"] } })).rejects.toMatchObject({ code: "unsupported" });
    expect(mock.builder).not.toHaveBeenCalled();
  });
});
