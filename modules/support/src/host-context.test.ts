import { beforeEach, describe, expect, it, vi } from "vitest";

const currentTenant = vi.hoisted(() => vi.fn());
const currentSession = vi.hoisted(() => vi.fn());
const nativeModuleEnabled = vi.hoisted(() => vi.fn());
const resolvePermissions = vi.hoisted(() => vi.fn());


import { createSupportContext } from "./host-context";
import type { ModuleHostServices } from "@opentenant/database/module-host";
const supportContext = createSupportContext({ currentTenant, currentSession, nativeModuleEnabled, resolvePermissions } as unknown as ModuleHostServices);

beforeEach(() => {
  vi.clearAllMocks();
  currentTenant.mockResolvedValue({ tenantId: "ten_a", displayName: "Example Organisation" });
  nativeModuleEnabled.mockResolvedValue(true);
  currentSession.mockResolvedValue({
    userId: "user_1",
    activeTenantId: "ten_a",
    activeRole: "member",
    isPlatformAdmin: false,
  });
});

describe("supportContext capabilities", () => {
  it("keeps requester permissions distinct from tenant queue and triage permissions", async () => {
    resolvePermissions.mockResolvedValue([
      "support.ticket.create",
      "support.ticket.read_own",
      "support.ticket.reply_own",
    ]);

    const result = await supportContext();

    expect(result.ok && result.context.capabilities).toEqual({
      create: true,
      readOwn: true,
      replyOwn: true,
      readTenant: false,
      replyTenant: false,
      noteInternal: false,
      assign: false,
      manage: false,
      viewDeliveryFailures: false,
    });
  });

  it("allows a read-only tenant queue without silently granting create or management", async () => {
    resolvePermissions.mockResolvedValue(["support.ticket.read_tenant"]);

    const result = await supportContext();

    expect(result.ok).toBe(true);
    expect(result.ok && result.context.capabilities.readTenant).toBe(true);
    expect(result.ok && result.context.capabilities.create).toBe(false);
    expect(result.ok && result.context.capabilities.manage).toBe(false);
  });
});
