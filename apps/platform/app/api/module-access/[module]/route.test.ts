vi.mock("../../../../opentenant-modules", () => ({ installedModules: { get: (key: string) => key === "sample" ? { permissions: { passcode: ["sample.use"] }, routes: [{ path: "/sample" }] } : undefined } }));
vi.mock("../../../../lib/rate-limit", () => ({ enforceRateLimit: () => null }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ admit: vi.fn(), release: vi.fn(), tenant: vi.fn(), session: vi.fn(), verify: vi.fn(), fingerprint: vi.fn() }));
vi.mock("../../../../lib/admission", () => ({ admitPlatformRequest: h.admit, releasePlatformAdmission: h.release }));
vi.mock("../../../../lib/tenant", () => ({ currentTenant: h.tenant }));
vi.mock("../../../../lib/session", () => ({ currentSession: h.session }));
vi.mock("../../../../lib/module-access", () => ({
  accessCookieName: () => "sample_access",
  passcodeAdmissionFingerprint: h.fingerprint,
  verifyModulePasscode: h.verify,
}));
vi.mock("../../../../lib/module-registry", () => ({ nativeModuleEnabled: () => true }));
import { POST as handler } from "./route";

function request(passcode = "synthetic-passcode", headers: Record<string, string> = {}) {
  const body = new FormData(); body.set("passcode", passcode);
  return new Request("https://app.example.test/api/module-access/sample", { method: "POST", headers, body });
}

describe("sample module-access admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tenant.mockResolvedValue({ tenantId: "tenant_alpha" });
    h.session.mockResolvedValue({ userId: "user_alpha" });
    h.admit.mockResolvedValue({ admitted: true, replayed: false, lease: { leaseId: "a".repeat(32), scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "sample.module-access.verify" } } });
    h.release.mockResolvedValue({ status: "released" });
    h.fingerprint.mockReturnValue("f".repeat(64));
    h.verify.mockResolvedValue({ granted: false });
  });

  it("cannot grant module access and binds the attempt to trusted scope", async () => {
    const response = await POST(request("wrong", { "x-real-ip": "caller-controlled" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=1");
    expect(h.admit).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "sample.module-access.verify" },
    }), expect.objectContaining({ maxRequests: 10, maxSizeBytes: 128 }));
    expect(h.verify).toHaveBeenCalledWith("tenant_alpha", "sample", "wrong");
    expect(h.fingerprint).toHaveBeenCalledWith("tenant_alpha", "sample", "wrong");
    expect(h.admit).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: "f".repeat(64),
    }), expect.anything());
    expect(h.release).toHaveBeenCalledWith({
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "sample.module-access.verify" },
      leaseId: "a".repeat(32),
    });
  });

  it("releases the exact lease when passcode verification fails", async () => {
    h.verify.mockRejectedValueOnce(new Error("synthetic verification failure"));
    await expect(POST(request())).rejects.toThrow("synthetic verification failure");
    expect(h.release).toHaveBeenCalledWith({
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "sample.module-access.verify" },
      leaseId: "a".repeat(32),
    });
  });

  it("does not verify a replay and distinguishes admission infrastructure failure", async () => {
    h.admit.mockResolvedValueOnce({ admitted: true, replayed: true, lease: { leaseId: "b".repeat(32), scope: {} } });
    expect((await POST(request())).status).toBe(409);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();

    h.admit.mockResolvedValueOnce({ admitted: false, code: "control_plane_unavailable" });
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toBe("service unavailable");

    h.admit.mockResolvedValueOnce({ admitted: false, code: "invalid_request" });
    const invalid = await POST(request());
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe("invalid request");
  });

  it("keeps validation, tenant resolution, limiting and successful cookie behavior", async () => {
    expect((await POST(request(""))).status).toBe(303);
    h.tenant.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(404);
    h.admit.mockResolvedValueOnce({ admitted: false, code: "rate_limited" });
    expect((await POST(request())).status).toBe(429);
    h.verify.mockResolvedValueOnce({ granted: true, cookieValue: "sealed-synthetic-value" });
    const granted = await POST(request());
    expect(granted.status).toBe(303);
    expect(granted.headers.get("set-cookie")).toContain("sample_access=sealed-synthetic-value");
  });

  it("uses a server-owned anonymous principal and never exposes the passcode on denial", async () => {
    h.session.mockResolvedValueOnce(null);
    h.admit.mockResolvedValueOnce({ admitted: false, code: "idempotency_conflict" });
    const response = await POST(request("private-passcode", { "idempotency-key": "same-key" }));
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("idempotency conflict");
    expect(h.admit).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ principalId: "anonymous-passcode-attempt" }),
      fingerprint: expect.not.stringContaining("private-passcode"),
    }), expect.anything());
    expect(h.verify).not.toHaveBeenCalled();
  });
});

function POST(req: Request) { return handler(req, { params: Promise.resolve({ module: "sample" }) }); }
