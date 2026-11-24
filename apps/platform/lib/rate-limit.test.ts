import { installedModules } from "../opentenant-modules";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimitGate, rateLimitKey, routeClassForPath, trustedRateLimitIp } from "./rate-limit";

describe("persistent mutation rate limit", () => {
  it("keys by tenant user and fixed route class without storing their values", () => {
    const key = rateLimitKey({ tenantId: "ten_one", userId: "usr_one", routeClass: "settings" });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toEqual(rateLimitKey({ tenantId: "ten_two", userId: "usr_one", routeClass: "settings" }));
    expect(key).not.toEqual(rateLimitKey({ tenantId: "ten_one", userId: "usr_two", routeClass: "settings" }));
    expect(key).not.toEqual(rateLimitKey({ tenantId: "ten_one", userId: "usr_one", routeClass: "members" }));
  });
  it("returns 429 and a rounded Retry-After on exhaustion", async () => {
    const gate = createRateLimitGate({ consume: vi.fn().mockRejectedValue({ msBeforeNext: 1201 }) });
    const response = await gate({ tenantId: "ten_one", userId: "usr_one", routeClass: "settings" });
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("2");
  });
  it("fails closed without returning database errors or using an in-memory fallback", async () => {
    const gate = createRateLimitGate({ consume: vi.fn().mockRejectedValue(new Error("private connection string")) });
    const response = await gate({ tenantId: "ten_one", userId: "usr_one", routeClass: "settings" });
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain("private");
  });
  it.each([
    ["/api/settings/members", "members"], ["/api/settings/identity-portal", "identity-portal"],
    ["/api/settings/branding", "settings"], ["/api/support/tickets", installedModules.apiRoute("/api/support/tickets")!.rateLimitClass],
    ["/api/admin/brand-proposals", "brand-proposal"], ["/api/admin/tenants", "tenant-creation"],
    ["/api/module-access/sample", "passcode"], ["/m/sample/resource", "module-access"],
  ])("classifies %s using a bounded vocabulary", (path, expected) => {
    expect(routeClassForPath(path)).toBe(expected);
  });
});


describe("trusted ingress IP", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("ignores arbitrary forwarding headers by default", () => {
    vi.stubEnv("OPENTENANT_TRUSTED_IP_HEADER", "");
    expect(trustedRateLimitIp(new Request("https://example.test", { headers: { "x-forwarded-for": "192.0.2.1" } }))).toBe("unattributed");
  });
  it("accepts one address only from the configured ingress header", () => {
    vi.stubEnv("OPENTENANT_TRUSTED_IP_HEADER", "x-ingress-ip");
    expect(trustedRateLimitIp(new Request("https://example.test", { headers: { "x-ingress-ip": "192.0.2.1" } }))).toBe("192.0.2.1");
    expect(trustedRateLimitIp(new Request("https://example.test", { headers: { "x-ingress-ip": "192.0.2.1,192.0.2.2" } }))).toBe("unattributed");
    expect(trustedRateLimitIp(new Request("https://example.test", { headers: { "x-ingress-ip": "999.999.0.1" } }))).toBe("unattributed");
  });
});
