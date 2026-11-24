// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import type { ModuleManifest } from "@opentenant/module-sdk";
import type { AuthorizationContext, AuthorizationOptions, AuthorizationPort, CheckRequest, PermissionRequest } from "../src/port";

export const CONFORMANCE_MANIFEST: ModuleManifest = {
  key: "example", version: "1.0.0", runtime: "remote", navigation: [],
  permissions: ["example.use", "example.edit", "example.admin"],
  rolePermissions: {
    tenant_owner: ["example.use", "example.edit", "example.admin"],
    tenant_admin: ["example.use", "example.edit"],
    tenant_member: ["example.use"],
  },
};
export const CONFORMANCE_REQUEST: PermissionRequest = { tenantId: "ten_a", userId: "user_a", moduleKey: "example" };
/** Factory must return an isolated adapter/store per test. No provider objects required. */
export function authorizationConformance(name: string, factory: (options: AuthorizationOptions) => Promise<AuthorizationPort>): void {
  describe(`${name} AuthorizationPort conformance`, () => {
    let port: AuthorizationPort;
    let context: AuthorizationContext;
    let failure: "none" | "error" | "timeout";
    beforeEach(async () => {
      context = { manifest: structuredClone(CONFORMANCE_MANIFEST), entitled: true, roles: ["tenant_admin"], claims: ["example.edit", "example.admin", "example.forged"] };
      failure = "none";
      port = await factory({ timeoutMs: 1000, loadContext: async (request) => {
        if (failure === "error") throw new Error("synthetic context failure");
        if (failure === "timeout") return new Promise(() => undefined);
        return request.moduleKey === "example" ? context : null;
      } });
      expect(await port.writeRelationships({ tenantId: "ten_a", relationships: [
        { kind: "membership", userId: "user_a", role: "tenant_admin" }, { kind: "entitlement", moduleKey: "example" },
      ] })).toBe(true);
    });
    it("intersects role map, declared permissions and claims", async () => {
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use", "example.edit"]);
    });
    it("allows an authorized object check", async () => {
      expect(await port.check({ ...CONFORMANCE_REQUEST, relation: "example.edit", object: { tenantId: "ten_a", moduleKey: "example" } })).toBe(true);
    });
    it("denies undeclared and role-escalating claims", async () => {
      for (const relation of ["example.forged", "example.admin", "other.edit"]) {
        expect(await port.check({ ...CONFORMANCE_REQUEST, relation, object: { tenantId: "ten_a", moduleKey: "example" } })).toBe(false);
      }
    });
    it("keeps base use while empty claims narrow elevated grants", async () => {
      context.claims = [];
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use"]);
    });
    it("denies a disabled live entitlement", async () => {
      context.entitled = false;
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    });
    it("denies missing live membership", async () => {
      context.roles = [];
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    });
    it("denies unknown modules", async () => {
      expect(await port.listPermissions({ ...CONFORMANCE_REQUEST, moduleKey: "unknown" })).toEqual([]);
    });
    it("denies cross-tenant objects and unsynced tenant memberships", async () => {
      expect(await port.check({ ...CONFORMANCE_REQUEST, relation: "example.edit", object: { tenantId: "ten_b", moduleKey: "example" } })).toBe(false);
      expect(await port.listPermissions({ ...CONFORMANCE_REQUEST, tenantId: "ten_b" })).toEqual([]);
    });
    it("replays writes and deletes idempotently and revokes entitlement", async () => {
      const request = { tenantId: "ten_a", relationships: [{ kind: "entitlement" as const, moduleKey: "example" }] };
      expect(await port.writeRelationships(request)).toBe(true);
      expect(await port.writeRelationships(request)).toBe(true);
      expect(await port.deleteRelationships(request)).toBe(true);
      expect(await port.deleteRelationships(request)).toBe(true);
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    });
    it("revokes membership without affecting another tenant", async () => {
      expect(await port.deleteRelationships({ tenantId: "ten_a", relationships: [{ kind: "membership", userId: "user_a", role: "tenant_admin" }] })).toBe(true);
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    });
    it("intersects a newer synced role with live context permissions", async () => {
      expect(await port.deleteRelationships({ tenantId: "ten_a", relationships: [{ kind: "membership", userId: "user_a", role: "tenant_admin" }] })).toBe(true);
      expect(await port.writeRelationships({ tenantId: "ten_a", relationships: [{ kind: "membership", userId: "user_a", role: "tenant_member" }] })).toBe(true);
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual(["example.use"]);
    });
    it("fails closed on context errors", async () => {
      failure = "error";
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    });
    it("fails closed on context timeouts", async () => {
      failure = "timeout";
      expect(await port.listPermissions(CONFORMANCE_REQUEST)).toEqual([]);
    });
    it("denies malformed runtime objects without throwing", async () => {
      expect(await port.check({ ...CONFORMANCE_REQUEST, relation: "example.edit", object: null } as unknown as CheckRequest)).toBe(false);
    });
    it("rejects tuple syntax injection", async () => {
      expect(await port.writeRelationships({ tenantId: "ten_a:ten_b", relationships: [{ kind: "membership", userId: "user_b", role: "tenant_admin" }] })).toBe(false);
      expect(await port.listPermissions({ ...CONFORMANCE_REQUEST, userId: "user_a#active" })).toEqual([]);
    });
  });
}
