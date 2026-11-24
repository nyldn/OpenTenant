import { describe, expect, it, vi } from "vitest";
import { authorizationConformance, CONFORMANCE_MANIFEST, CONFORMANCE_REQUEST } from "../testing";
import { InProcessAuthorization } from "./adapters/in-process";
import { createAuthorization } from "./provider";
import { syncEntitlement, syncMembership } from "./sync";

authorizationConformance("in-process", async (options) => new InProcessAuthorization(options));

describe("legacy compatibility and provider composition", () => {
  it("retains legacy prefixed claims only when rolePermissions is omitted", async () => {
    const { rolePermissions: _map, ...manifest } = CONFORMANCE_MANIFEST;
    const loadContext = async () => ({ manifest, entitled: true, roles: ["tenant_member" as const], claims: ["example.forged", "other.admin"] });
    const port = new InProcessAuthorization({ loadContext });
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use", "example.forged"]);
    expect(await new InProcessAuthorization({ loadContext: async () => ({ ...await loadContext(), manifest: { ...manifest, rolePermissions: {} } }) }).listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
  });
  it("uses the map without claims when the identity integration provides no restriction", async () => {
    const port = new InProcessAuthorization({ loadContext: async () => ({ manifest: CONFORMANCE_MANIFEST, entitled: true, roles: ["tenant_admin"] }) });
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use", "example.edit"]);
  });
  it("defaults to in-process and rejects unknown or incomplete provider config", async () => {
    const options = { loadContext: async () => null };
    expect(await createAuthorization({}, options)).toBeInstanceOf(InProcessAuthorization);
    await expect(createAuthorization({ AUTHZ_PROVIDER: "typo" }, options)).rejects.toThrow("configuration");
    await expect(createAuthorization({ AUTHZ_PROVIDER: "openfga" }, options)).rejects.toThrow("configuration");
  });
  it("syncs role changes and entitlement revocation through the port", async () => {
    const context = { manifest: CONFORMANCE_MANIFEST, entitled: true, roles: ["tenant_admin" as const], claims: ["example.edit"] };
    const port = new InProcessAuthorization({ loadContext: async () => context });
    expect(await syncMembership(port, { tenantId: "ten_a", userId: "user_a", role: "tenant_admin", active: true })).toBe(true);
    expect(await syncEntitlement(port, { tenantId: "ten_a", moduleKey: "example", enabled: true })).toBe(true);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toContain("example.edit");
    expect(await syncMembership(port, { tenantId: "ten_a", userId: "user_a", role: "tenant_member", active: true })).toBe(true);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use"]);
    expect(await syncEntitlement(port, { tenantId: "ten_a", moduleKey: "example", enabled: false })).toBe(true);
  });
  it("does not write a role after deletion fails", async () => {
    const port = { check: vi.fn(), listPermissions: vi.fn(), deleteRelationships: vi.fn().mockResolvedValue(false), writeRelationships: vi.fn() };
    expect(await syncMembership(port, { tenantId: "ten_a", userId: "user_a", role: "tenant_admin", active: true })).toBe(false);
    expect(port.writeRelationships).not.toHaveBeenCalled();
  });
});
