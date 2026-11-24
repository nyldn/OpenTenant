import { afterEach, describe, expect, it, vi } from "vitest";
import { IsolatedSandboxAdapter, type IsolatedInstance, shellArg } from "./isolated";
import { vendorRequest } from "../testing/vendor-fixtures";

afterEach(() => { vi.useRealTimers(); });
describe("SDK adapter lifecycle", () => {
  function setup(changes: Partial<IsolatedInstance> = {}) {
    const instance: IsolatedInstance = { id: "synthetic", write: vi.fn(async () => undefined), run: vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" })), read: vi.fn(async () => new Uint8Array()), kill: vi.fn(async () => undefined), ...changes };
    return { instance, adapter: new IsolatedSandboxAdapter("fixture", { create: async () => instance }, false) };
  }
  it("kills when lifetime expires without another caller operation", async () => {
    vi.useFakeTimers();
    const { adapter, instance } = setup();
    await adapter.create(vendorRequest());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(instance.kill).toHaveBeenCalledOnce();
  });
  it("kills on invalid paths before file I/O", async () => {
    const { adapter, instance } = setup();
    const workspace = await adapter.create(vendorRequest());
    await expect(adapter.writeFiles({ sandboxId: workspace.id, files: [{ path: "../secret", contents: new Uint8Array() }] })).rejects.toMatchObject({ code: "policy_denied" });
    expect(instance.write).not.toHaveBeenCalled();
    expect(instance.kill).toHaveBeenCalledOnce();
  });
  it("kills on nonzero commands and bounds combined UTF-8 output", async () => {
    const { adapter, instance } = setup({ run: async () => ({ exitCode: 1, stdout: "ééé", stderr: "private" }) });
    const workspace = await adapter.create(vendorRequest());
    const result = await adapter.runCommand({ sandboxId: workspace.id, executable: "node", args: ["a';$(echo unsafe)"], cwd: "workspace/app", timeoutMs: 100, outputLimitBytes: 3 });
    expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(3);
    expect(result.exitCode).toBe(1);
    expect(result.outputTruncated).toBe(true);
    expect(instance.kill).toHaveBeenCalledOnce();
    expect(shellArg("a'b")).toBe("'a'\\''b'");
  });
  it("kills stalled operations at their deadline", async () => {
    vi.useFakeTimers();
    const { adapter, instance } = setup({ write: () => new Promise(() => undefined) });
    const workspace = await adapter.create(vendorRequest());
    const result = expect(adapter.writeFiles({ sandboxId: workspace.id, files: [{ path: "workspace/app/test", contents: new Uint8Array() }] })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(instance.kill).toHaveBeenCalledOnce();
  });
  it("keeps a failed teardown retryable", async () => {
    const kill = vi.fn().mockRejectedValueOnce(new Error("private failure")).mockResolvedValue(undefined);
    const { adapter } = setup({ kill });
    const workspace = await adapter.create(vendorRequest());
    await expect(adapter.terminate(workspace.id)).rejects.toMatchObject({ code: "provider_failure" });
    await adapter.terminate(workspace.id);
    expect(kill).toHaveBeenCalledTimes(2);
  });
});
