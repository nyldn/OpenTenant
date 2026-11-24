import { describe, expect, it } from "vitest";
import {
  decideModuleCapability,
  normalizeModuleCapabilityRequests,
  type ModuleCapabilityEvaluation,
} from "./index";

const allowedInput: ModuleCapabilityEvaluation = {
  moduleKey: "tenant-portal",
  capability: "support.ticket.read",
  ownershipScope: "tenant",
  tenantBound: true,
  activeVersionBound: true,
  manifestRequested: true,
  creatorAuthorized: true,
  tenantGranted: true,
  grantActive: true,
  identityBacked: true,
  requiredRuntimePermission: "tenant-portal.support-ticket-read",
  runtimePermissions: ["tenant-portal.use", "tenant-portal.support-ticket-read"],
};

describe("module capability policy", () => {
  it("normalizes a closed manifest request with a module-bound runtime permission", () => {
    expect(normalizeModuleCapabilityRequests("tenant-portal", [{
      capability: "support.ticket.read",
      runtimePermission: "tenant-portal.support-ticket-read",
    }])).toEqual([{
      capability: "support.ticket.read",
      runtimePermission: "tenant-portal.support-ticket-read",
    }]);
    expect(normalizeModuleCapabilityRequests("tenant-portal", [{
      capability: "support.ticket.read",
      runtimePermission: "tenant-portal.support_ticket_read",
    }])).toEqual([{
      capability: "support.ticket.read",
      runtimePermission: "tenant-portal.support_ticket_read",
    }]);

    expect(() => normalizeModuleCapabilityRequests("tenant-portal", [{
      capability: "tenant.database.access.broad" as "support.ticket.read",
      runtimePermission: "tenant-portal.database",
    }])).toThrow("unknown module capability");
    expect(() => normalizeModuleCapabilityRequests("tenant-portal", [{
      capability: "support.ticket.read",
      runtimePermission: "other-module.support-ticket-read",
    }])).toThrow("module-bound runtime permission");
  });

  it.each([
    ["unknown_capability", { capability: "unknown.read" }],
    ["unknown_ownership_scope", { ownershipScope: "shared" }],
    ["tenant_binding_invalid", { tenantBound: false }],
    ["tenant_binding_invalid", { activeVersionBound: false }],
    ["manifest_not_requested", { manifestRequested: false }],
    ["creator_authority_denied", { creatorAuthorized: false }],
    ["tenant_grant_missing", { tenantGranted: false }],
    ["grant_inactive", { grantActive: false }],
    ["identity_required", { identityBacked: false }],
    ["runtime_permission_denied", { runtimePermissions: ["tenant-portal.use"] }],
    ["runtime_permission_denied", { requiredRuntimePermission: "other-module.read" }],
  ] as const)("denies %s before broker execution", (reason, override) => {
    expect(decideModuleCapability({ ...allowedInput, ...override })).toEqual({
      allowed: false,
      reason,
    });
  });

  it("allows only the complete creator, tenant, runtime, version, and ownership intersection", () => {
    expect(decideModuleCapability(allowedInput)).toEqual({ allowed: true });
  });
});
