import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ run: vi.fn(async () => ({ promise: Promise.resolve() })), end: vi.fn() }));
vi.mock("graphile-worker", () => ({ run: state.run, runOnce: vi.fn(), runMigrations: vi.fn() }));
vi.mock("../lib/control-plane", () => ({ controlPlanePool: () => ({ end: state.end }) }));
vi.mock("./tenant-worker", () => ({ tenantWorkerTasks: { tenant_job: vi.fn() }, TENANT_WORKER_CRONTAB: "registered-crontab" }));
it("registers the worker tasks and crontab and aborts running exports as graceful shutdown starts", async () => {
  await import("./worker");
  expect(state.run).toHaveBeenCalledWith(expect.objectContaining({
    taskList: { tenant_job: expect.any(Function) }, crontab: "registered-crontab", concurrency: 2,
    noHandleSignals: false, gracefulShutdownAbortTimeout: 0,
  }));
  expect(state.end).toHaveBeenCalledOnce();
});
