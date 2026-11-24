import { describe, expect, it, vi } from "vitest";
import { executeProvisioningJob } from "./tenant-worker-tasks";

describe("durable provisioning task", () => {
  const input = { tenantId: "tenant_example", tenantSlug: "example", dataRegion: "us" as const };
  it("resumes database checkpoints before issuing an owner invite and activating", async () => {
    const calls: string[] = [];
    await executeProvisioningJob(input, {
      provision: async () => { calls.push("database"); },
      inviteOwner: async () => { calls.push("owner"); },
      activate: async () => { calls.push("activate"); },
    });
    expect(calls).toEqual(["database", "owner", "activate"]);
  });
  it("leaves activation pending when owner issuance fails", async () => {
    const activate = vi.fn();
    await expect(executeProvisioningJob(input, { provision: vi.fn(), inviteOwner: async () => { throw new Error("synthetic"); }, activate })).rejects.toThrow();
    expect(activate).not.toHaveBeenCalled();
  });
});
