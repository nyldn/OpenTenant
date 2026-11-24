import { describe, expect, it, vi } from "vitest";
import { createTenantExportRunner } from "./tenant-worker-tasks";
import type { TenantWorkerJob } from "../lib/tenant-worker-store";

describe("process-wide export serialization", () => {
  const job = (id: string) => ({ id } as TenantWorkerJob);
  it("runs one archive at a time and continues after failure", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    const run = createTenantExportRunner(async input => {
      calls.push(input.id);
      if (input.id === "first") { await gate; throw new Error("cancelled"); }
    });
    const first = run(job("first"));
    const failed = expect(first).rejects.toThrow("cancelled");
    const second = run(job("second"));
    await Promise.resolve();
    expect(calls).toEqual(["first"]);
    release();
    await failed; await second;
    expect(calls).toEqual(["first", "second"]);
  });
  it("forwards the live signal and skips an export cancelled while waiting", async () => {
    const controller = new AbortController();
    const exportJob = vi.fn(async (_input: TenantWorkerJob, signal?: AbortSignal) => { expect(signal).toBe(controller.signal); });
    const run = createTenantExportRunner(exportJob);
    await run(job("first"), controller.signal);
    controller.abort();
    await expect(run(job("cancelled"), controller.signal)).rejects.toThrow();
    expect(exportJob).toHaveBeenCalledTimes(1);
  });
});
