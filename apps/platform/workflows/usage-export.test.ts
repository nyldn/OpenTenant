import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobHelpers } from "graphile-worker";
import { FileUsageExportSink, OpenMeterUsageExportSink, runUsageExport } from "@opentenant/usage-export";
import { serverConfig } from "../lib/server-config";
import { configuredUsageExportSink } from "./usage-export";
import { TENANT_WORKER_CRONTAB, tenantWorkerTasks } from "./tenant-worker";
const pool = vi.hoisted(() => ({}));
vi.mock("../lib/control-plane", () => ({ controlPlanePool: () => pool, withControlPlaneTransaction: vi.fn() }));
vi.mock("@opentenant/usage-export", async (original) => ({ ...await original<object>(), runUsageExport: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("scheduled usage export", () => {
  const config = (env: Record<string, string> = {}) => serverConfig({ NODE_ENV: "test", ...env });
  it("defaults to a local file sink and separates destination receipts", () => {
    expect(configuredUsageExportSink(config())).toBeInstanceOf(FileUsageExportSink);
    const first = configuredUsageExportSink(config({ USAGE_EXPORT_DIRECTORY: "/tmp/usage-a" }));
    expect(first.id).toBe(configuredUsageExportSink(config({ USAGE_EXPORT_DIRECTORY: "/tmp/usage-a" })).id);
    expect(first.id).not.toBe(configuredUsageExportSink(config({ USAGE_EXPORT_DIRECTORY: "/tmp/usage-b" })).id);
  });
  it("requires configured OpenMeter credentials before selecting the remote sink", () => {
    expect(configuredUsageExportSink(config({ OPENMETER_INGEST_URL: "https://meter.example.test/api/v1/events" }))).toBeInstanceOf(FileUsageExportSink);
    expect(() => configuredUsageExportSink(config({ USAGE_EXPORT_SINK: "openmeter" }))).toThrow("configuration");
    expect(configuredUsageExportSink(config({ OPENMETER_INGEST_URL: "https://meter.example.test/api/v1/events", OPENMETER_API_KEY: "synthetic" }))).toBeInstanceOf(OpenMeterUsageExportSink);
    expect(() => configuredUsageExportSink(config({ USAGE_EXPORT_SINK: "unknown" }))).toThrow("configuration");
  });
  it("schedules bounded drains, logs counts and lets Graphile retry failures", async () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("USAGE_EXPORT_SINK", "file");
    expect(TENANT_WORKER_CRONTAB).toContain("* * * * * usage_export ?max=5");
    const info = vi.fn();
    const helpers = { logger: { info } } as unknown as JobHelpers;
    vi.mocked(runUsageExport).mockResolvedValueOnce({ exported: 3, batches: 1 });
    await tenantWorkerTasks.usage_export!({}, helpers);
    expect(runUsageExport).toHaveBeenCalledWith({ pool, sink: expect.any(FileUsageExportSink) });
    expect(info).toHaveBeenCalledWith("Usage export completed", { exported: 3, batches: 1 });
    vi.mocked(runUsageExport).mockRejectedValueOnce(new Error("usage_export_failed"));
    await expect(tenantWorkerTasks.usage_export!({}, helpers)).rejects.toThrow("usage_export_failed");
  });
});

it("registers the scheduled custom-domain re-verification task", () => {
  expect(TENANT_WORKER_CRONTAB).toContain("* * * * * custom_domain_reverify ?max=5");
  expect(typeof tenantWorkerTasks.custom_domain_reverify).toBe("function");
});
