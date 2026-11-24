import { accessSync, constants, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { expect, it } from "vitest";
import { MicrosandboxAdapter } from "./adapter";
import { vendorRequest } from "../../testing/vendor-fixtures";

const image = process.env.MICROSANDBOX_TEST_IMAGE;
let reason = image ? "" : "MICROSANDBOX_TEST_IMAGE is unset; nominate an approved cached digest";
if (!reason && process.platform !== "linux") reason = "Docker microVM isolation proof requires Linux";
if (!reason && process.platform === "linux") {
  try { accessSync("/dev/kvm", constants.R_OK | constants.W_OK); }
  catch { reason = "/dev/kvm is unavailable to this user"; }
}
if (reason && process.env.MICROSANDBOX_REQUIRED === "1") throw new Error(reason);

function kvmDescriptors(): string[] {
  return readdirSync("/proc").filter(name => /^\d+$/.test(name)).flatMap(pid => {
    try { return readdirSync(`/proc/${pid}/fd`).flatMap(fd => {
      try { const target = readlinkSync(`/proc/${pid}/fd/${fd}`); return /(?:\/dev\/kvm|kvm-vm|kvm-vcpu)/.test(target) ? [`${pid}/${fd}: ${target}`] : []; }
      catch { return []; }
    }); } catch { return []; }
  });
}

function runtimeProcesses(): string[] {
  return readdirSync("/proc").filter(name => /^\d+$/.test(name)).filter(name => {
    try { return /(?:\/msb|\/microsandbox)(?:\0|\s)/.test(readFileSync(`/proc/${name}/cmdline`, "utf8")); }
    catch { return false; } // Process exited between enumeration and read.
  });
}

it.skipIf(Boolean(reason))(`real local microsandbox lifecycle and isolation${reason ? ` NOT RUN: ${reason}` : ""}`, async () => {
  const start = performance.now();
  const sdk = await import("microsandbox");
  sdk.setDefaultBackend("local");
  expect((await sdk.Sandbox.list()).sandboxes).toHaveLength(0);
  expect(runtimeProcesses()).toEqual([]);
  expect(kvmDescriptors()).toEqual([]);
  let name = "";
  // Delegate every operation to the real native SDK, retaining its boot error
  // for this synthetic proof because the production adapter scrubs errors.
  class ProofSandbox extends sdk.Sandbox {
    static override builder(value: string) {
      name = value;
      const builder = super.builder(value);
      const create = builder.create.bind(builder);
      builder.create = async () => {
        try { return await create(); }
        catch (error) { console.error("Native microsandbox boot failure:", error); throw error; }
      };
      return builder;
    }
  }
  const request = vendorRequest();
  const adapter = new MicrosandboxAdapter({ provider: "microsandbox", sdk: { ...sdk, Sandbox: ProofSandbox }, templates: [{ ref: request.template, image: image!, cpuCores: 1, memoryMb: 512 }] });
  const bootStart = performance.now();
  const workspace = await adapter.create(request);
  expect(kvmDescriptors().length).toBeGreaterThan(0);
  console.log(JSON.stringify({ bootSeconds: (performance.now() - bootStart) / 1000 }));
  const command = (executable: string, args: string[], outputLimitBytes = 1000, timeoutMs = 5000) => adapter.runCommand({ sandboxId: workspace.id, executable, args, cwd: "tmp", timeoutMs, outputLimitBytes });
  try {
    await adapter.writeFiles({ sandboxId: workspace.id, files: [{ path: "tmp/proof.txt", contents: Buffer.from("synthetic proof") }] });
    expect(Buffer.from((await adapter.collectArtifact({ sandboxId: workspace.id, path: "tmp/proof.txt", maxBytes: 100 })).contents).toString()).toBe("synthetic proof");
    expect(await command("/bin/echo", ["local"])).toMatchObject({ exitCode: 0, stdout: "local\n" });
    const env = await command("/usr/bin/env", []);
    expect(env.exitCode).toBe(0);
    expect(env.stdout.trim().split("\n").sort()).toEqual(["HOME=/tmp", "PATH=/usr/local/bin:/usr/bin:/bin"]);
    expect(env.stdout).not.toContain("synthetic-host-only-canary");
    // Check the NIC is absent before attempting a public IP, so the probe
    // cannot contact that service even when the containing Docker has egress.
    const applet = await command("/bin/sh", ["-c", "/bin/busybox --list | grep -x nc"]);
    expect(applet).toMatchObject({ exitCode: 0, stdout: "nc\n" });
    const links = await command("/bin/sh", ["-c", "ls /sys/class/net"]);
    expect(links.exitCode).toBe(0);
    expect(links.stdout.trim().split("\n").filter(link => !["lo", "dummy0"].includes(link))).toEqual([]);
    expect(await command("/bin/sh", ["-c", "/bin/busybox ip route; /bin/busybox ip -6 route"])).toMatchObject({ exitCode: 0, stdout: "" });
    const host = process.env.MICROSANDBOX_PROOF_HOST;
    const port = process.env.MICROSANDBOX_PROOF_HOST_PORT;
    if (host !== "127.0.0.1" || !port || !/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new Error("Run pnpm sandbox:microvm-proof for the live host listener control");
    for (const [address, targetPort] of [["1.1.1.1", "443"], [host, port]]) {
      const attempt = await command("/bin/sh", ["-c", `if /bin/busybox nc -w 1 ${address} ${targetPort} </dev/null; then echo UNEXPECTED_CONNECTION; else echo DENIED; fi`]);
      expect(attempt).toMatchObject({ exitCode: 0, stdout: "DENIED\n" });
    }
    const output = await command("/bin/sh", ["-c", "head -c 4096 /dev/zero | tr '\\000' x"], 100);
    expect(output).toMatchObject({ exitCode: 0, stdout: "x".repeat(100), stderr: "", outputTruncated: true });
  } finally { await adapter.terminate(workspace.id); }
  await expect(sdk.Sandbox.get(name)).rejects.toMatchObject({ name: "SandboxNotFoundError" });
  expect((await sdk.Sandbox.list()).sandboxes).toHaveLength(0);
  expect(runtimeProcesses()).toEqual([]);
  expect(kvmDescriptors()).toEqual([]);

  // A deadline failure tears down its VM. Use a second VM so the explicit
  // terminate proof above cannot succeed merely because the timeout killed it.
  const timed = await adapter.create(request);
  try {
    const deadline = performance.now();
    const result = await adapter.runCommand({ sandboxId: timed.id, executable: "/bin/sleep", args: ["30"], cwd: "tmp", timeoutMs: 250, outputLimitBytes: 100 });
    expect(result.exitCode).toBe(-1);
    console.log(JSON.stringify({ commandTimeoutMs: 250, observedTimeoutMs: performance.now() - deadline }));
    expect(performance.now() - deadline).toBeLessThan(10_000);
  } finally { await adapter.terminate(timed.id); }
  await expect(sdk.Sandbox.get(name)).rejects.toMatchObject({ name: "SandboxNotFoundError" });
  expect((await sdk.Sandbox.list()).sandboxes).toHaveLength(0);
  expect(runtimeProcesses()).toEqual([]);
  expect(kvmDescriptors()).toEqual([]);
  console.log(JSON.stringify({ isolation: ["egress-public", "egress-host", "environment", "output-limit", "timeout", "destroy"], totalSeconds: (performance.now() - start) / 1000 }));
}, 120_000);
