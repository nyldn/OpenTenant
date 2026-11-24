import { describe, expect, it } from "vitest";
import { tenantEraseAllowed } from "./tenant-erase";
import type { TenantWorkerJob } from "./tenant-worker-store";
const job = { kind: "erase", status: "running", result: {} } as TenantWorkerJob;
const tenant = { status: "deleted", erase_after: new Date(0) };
describe("erase guard", () => {
  it("requires a current deleted tenant, elapsed retention and a live erase job", () => {
    expect(tenantEraseAllowed(tenant, job, new Date(1))).toBe(true);
    expect(() => tenantEraseAllowed({ ...tenant, erase_after: new Date(2) }, job, new Date(1))).toThrow("retention");
  });
  it("makes restored, missing, completed and revoked jobs no-ops", () => {
    for (const status of ["active", "suspended", "provisioning"]) expect(tenantEraseAllowed({ ...tenant, status }, job, new Date(1))).toBe(false);
    expect(tenantEraseAllowed(undefined, job, new Date(1))).toBe(false);
    expect(tenantEraseAllowed(tenant, undefined, new Date(1))).toBe(false);
    expect(tenantEraseAllowed(tenant, { ...job, status: "completed" }, new Date(1))).toBe(false);
    expect(tenantEraseAllowed(tenant, { ...job, result: { cancelled: "true" } }, new Date(1))).toBe(false);
    expect(tenantEraseAllowed(tenant, { ...job, kind: "export" }, new Date(1))).toBe(false);
  });
});
