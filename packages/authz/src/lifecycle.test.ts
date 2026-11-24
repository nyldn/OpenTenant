import { describe, expect, it } from "vitest";
import { authorizationConformance, CONFORMANCE_MANIFEST, CONFORMANCE_REQUEST } from "../testing";
import { OpenFgaAuthorization } from "./adapters/openfga";
import { SyntheticFga } from "./testing/synthetic-fga";
import { syncEntitlement, syncMembership } from "./sync";
import type { AuthorizationContext, AuthorizationOptions } from "./port";

const config = { apiUrl: "http://127.0.0.1:1", storeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", authorizationModelId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
function adapter(options: AuthorizationOptions, fga = new SyntheticFga()) { return new OpenFgaAuthorization(config, options, fga.client); }
authorizationConformance("OpenFGA synthetic model", async options => adapter(options));

function fixture() {
  const context: AuthorizationContext = { manifest: structuredClone(CONFORMANCE_MANIFEST), entitled: true, roles: ["tenant_admin"], membershipVersion: "member_1", moduleVersion: "module_1" };
  const fga = new SyntheticFga();
  const port = adapter({ loadContext: async () => context }, fga);
  const membership = { tenantId: "ten_a", userId: "user_a", role: "tenant_admin" as const, active: true, version: "member_1" };
  const entitlement = { tenantId: "ten_a", moduleKey: "example", enabled: true, version: "module_1", manifest: context.manifest };
  return { context, fga, port, membership, entitlement };
}

describe("immutable authorization lifecycle versions", () => {
  it("replays sync idempotently and revokes before every replacement", async () => {
    const { port, membership, entitlement, fga } = fixture();
    for (let i = 0; i < 2; i++) {
      expect(await syncMembership(port, membership)).toBe(true);
      expect(await syncEntitlement(port, entitlement)).toBe(true);
    }
    expect(fga.operations).toEqual(["revoke", "replace", "revoke", "replace", "revoke", "replace", "revoke", "replace"]);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use", "example.edit"]);
  });
  it("fences a delayed old-role write after role change followed by removal", async () => {
    const { port, membership, entitlement, context } = fixture();
    await syncMembership(port, membership); await syncEntitlement(port, entitlement);
    context.membershipVersion = "member_2"; context.roles = ["tenant_member"];
    await syncMembership(port, { ...membership, previousVersion: "member_1", version: "member_2", role: "tenant_member" });
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use"]);
    context.roles = []; context.membershipVersion = "member_3";
    await syncMembership(port, { ...membership, previousVersion: "member_2", version: "member_3", active: false });
    // Simulate a remote write arriving after its worker's lease expired.
    await port.writeRelationships({ tenantId: "ten_a", relationships: [{ kind: "membership", userId: "user_a", role: "tenant_admin", version: "member_1" }] });
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
  });
  it("cannot retain authority on outage, lost acknowledgement or retry", async () => {
    const { port, membership, entitlement, context, fga } = fixture();
    await syncMembership(port, membership); await syncEntitlement(port, entitlement);
    context.membershipVersion = "member_2"; context.roles = ["tenant_member"];
    fga.offline = true;
    const change = { ...membership, previousVersion: "member_1", version: "member_2", role: "tenant_member" as const };
    expect(await syncMembership(port, change)).toBe(false);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    fga.offline = false; fga.loseAcknowledgement = true;
    expect(await syncMembership(port, change)).toBe(false);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    expect(await syncMembership(port, change)).toBe(true);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use"]);
  });
  it("freezes manifest snapshots and cannot accumulate removed grantees", async () => {
    const { port, membership, entitlement, context } = fixture();
    await syncMembership(port, membership); await syncEntitlement(port, entitlement);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toContain("example.edit");
    const manifest = { ...context.manifest, version: "2", rolePermissions: { ...context.manifest.rolePermissions, tenant_admin: ["example.use"] } };
    const changed = { ...entitlement, previousVersion: "module_1", version: "module_2", manifest };
    context.moduleVersion = "module_2";
    await syncEntitlement(port, changed);
    // Keep an old local ceiling to prove the remote graph revocation itself.
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use"]);
    await port.writeRelationships({ tenantId: "ten_a", relationships: [{ kind: "entitlement", moduleKey: "example", version: "module_1", manifest: entitlement.manifest }] });
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use"]);
    context.moduleVersion = "module_3";
    await syncEntitlement(port, { ...changed, previousVersion: "module_2", version: "module_3", enabled: false });
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
  });
  it("bounds large manifest batches and writes the entitlement gate last", async () => {
    const { port, membership, entitlement, context, fga } = fixture();
    const permissions = Array.from({ length: 130 }, (_, index) => `example.permission_${index}`);
    context.manifest = { ...context.manifest, permissions, rolePermissions: { tenant_admin: permissions } };
    await syncMembership(port, membership);
    expect(await syncEntitlement(port, { ...entitlement, manifest: context.manifest })).toBe(true);
    expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(permissions);
    expect([...fga.tuples.values()].at(-1)?.relation).toBe("entitled");
  });
  it("binds every version to its tenant and rejects malformed versions", async () => {
    const { port, membership, entitlement } = fixture();
    await syncMembership(port, membership); await syncEntitlement(port, entitlement);
    expect(await port.listPermissions({ ...CONFORMANCE_REQUEST, tenantId: "ten_b" })).toEqual([]);
    expect(await port.writeRelationships({ tenantId: "ten_a", relationships: [{ kind: "membership", userId: "user_a", role: "tenant_owner", version: "bad~version" }] })).toBe(false);
  });
});
