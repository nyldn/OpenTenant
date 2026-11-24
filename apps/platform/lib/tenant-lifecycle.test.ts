import { describe, expect, it } from "vitest";
import { lifecycleTransition, suspendedTenantResponse, validateOwnerEmail } from "./tenant-lifecycle-policy";

describe("tenant lifecycle policy", () => {
  it.each(["active", "suspended"])("soft deletes %s with a future retention deadline", (status) => {
    expect(lifecycleTransition(status, "delete", new Date(0), 72)).toEqual({ status: "deleted", eraseAfter: new Date(72 * 3600000) });
  });
  it("suspends and resumes only the expected prior state", () => {
    expect(lifecycleTransition("active", "suspend", new Date(0), 72).status).toBe("suspended");
    expect(lifecycleTransition("suspended", "resume", new Date(0), 72).status).toBe("active");
    expect(() => lifecycleTransition("deleted", "resume", new Date(0), 72)).toThrow();
    expect(() => lifecycleTransition("provisioning", "suspend", new Date(0), 72)).toThrow();
  });
  it.each([0, -1, NaN, Infinity])("rejects unsafe retention %s", (hours) => {
    expect(() => lifecycleTransition("active", "delete", new Date(), hours)).toThrow();
  });
  it("provides a private 423 response for shared gates to use", () => {
    expect(suspendedTenantResponse().status).toBe(423);
    expect(suspendedTenantResponse().headers.get("cache-control")).toBe("no-store");
  });
  it("validates and normalizes the bootstrap email", () => {
    expect(validateOwnerEmail(" Owner@Example.test ")).toBe("owner@example.test");
    expect(() => validateOwnerEmail("invalid")).toThrow();
  });
});
