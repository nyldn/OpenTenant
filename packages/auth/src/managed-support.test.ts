import { describe, expect, it } from "vitest";
import {
  authorizeSupportAction,
  classifySupportAction,
  type ManagedSupportSession,
} from "./managed-support";

const session: ManagedSupportSession = {
  sessionId: "sup_example",
  installationId: "ins_example",
  tenantId: "ten_example",
  operatorUserId: "usr_operator",
  reason: "Repair approved tenant configuration",
  reference: "CHG-123",
  allowedActionClasses: ["routine_configuration"],
  createdAt: new Date("2026-07-22T10:00:00Z"),
  lastActivityAt: new Date("2026-07-22T10:05:00Z"),
  expiresAt: new Date("2026-07-22T10:30:00Z"),
  revokedAt: null,
};

describe("managed support policy", () => {
  it("classifies only bounded configuration changes as routine", () => {
    expect(classifySupportAction("branding.configure")).toBe("routine_configuration");
    expect(classifySupportAction("module.settings.configure")).toBe("routine_configuration");
    expect(classifySupportAction("domain.metadata.configure")).toBe("routine_configuration");
    expect(classifySupportAction("integration.metadata.configure")).toBe("routine_configuration");
  });

  it.each([
    "customer_data.read",
    "customer_data.export",
    "credential.rotate",
    "module.access.configure",
    "data.delete",
    "billing.manage",
    "identity.manage",
    "module.capability.grant",
    "domain.activate",
    "integration.authorize",
  ] as const)("requires separate authority for %s", (action) => {
    expect(classifySupportAction(action)).toBe("sensitive");
    expect(authorizeSupportAction(session, action, new Date("2026-07-22T10:10:00Z"))).toEqual({
      allowed: false,
      reason: "separate_sensitive_authority_required",
    });
  });

  it("fails closed for expired, revoked, mismatched, and unknown context", () => {
    expect(authorizeSupportAction(session, "branding.configure", new Date("2026-07-22T10:31:00Z"))).toEqual({
      allowed: false,
      reason: "inactive_support_session",
    });
    expect(authorizeSupportAction({ ...session, revokedAt: new Date() }, "branding.configure")).toEqual({
      allowed: false,
      reason: "inactive_support_session",
    });
    expect(authorizeSupportAction(session, "unknown" as never)).toEqual({
      allowed: false,
      reason: "unknown_support_action",
    });
  });
});
