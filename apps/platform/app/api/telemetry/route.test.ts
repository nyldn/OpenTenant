vi.mock("../../../opentenant-modules", () => ({ installedModules: { modules: [{ telemetry: {
    "sample.page.viewed": {},
    "sample.readout.completed": { provider: "string", latencyMs: "number" },
    "sample.readout.failed": { provider: "string", errorCode: "string", latencyMs: "number" },
    "sample.export.completed": { format: "string", respondentCount: "number" },
    "sample.import.completed": { respondentCount: "number" },
    "sample.import.rejected": { errorCount: "number" },
  } }] } }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ log: vi.fn(), admit: vi.fn(), release: vi.fn(), tenant: vi.fn(), session: vi.fn() }));
vi.mock("@opentenant/observability/logger", () => ({ createLogger: () => ({ info: h.log }) }));
vi.mock("../../../lib/admission", () => ({ admitPlatformRequest: h.admit, releasePlatformAdmission: h.release }));
vi.mock("../../../lib/tenant", () => ({ currentTenant: h.tenant }));
vi.mock("../../../lib/session", () => ({ currentSession: h.session }));
import { POST } from "./route";

const event = JSON.stringify({
  name: "sample.readout.completed",
  tenantId: "tenant_alpha",
  moduleKey: "sample",
  moduleVersion: "1.0.0",
  occurredAt: "2026-08-06T12:00:00.000Z",
  properties: { provider: "openai", latencyMs: 250 },
});
const request = (body = event, headers: Record<string, string> = {}) => new Request("https://app.example.test/api/telemetry", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body,
});

describe("telemetry route admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tenant.mockResolvedValue({ tenantId: "tenant_alpha" });
    h.session.mockResolvedValue({ userId: "user_alpha" });
    h.admit.mockResolvedValue({ admitted: true, replayed: false, lease: { leaseId: "a".repeat(32), scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "telemetry.event.record" } } });
    h.release.mockResolvedValue({ status: "released" });
  });

  it("does not record an admitted replay and releases only fresh admissions", async () => {
    h.admit.mockResolvedValueOnce({ admitted: true, replayed: true, lease: { leaseId: "b".repeat(32), scope: {} } });
    const replay = await POST(request(event, { "idempotency-key": "replayed" }));
    expect(replay.status).toBe(409);
    expect(h.log).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();

    h.admit.mockResolvedValueOnce({ admitted: true, replayed: false, lease: { leaseId: "c".repeat(32), scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "telemetry.event.record" } } });
    expect((await POST(request())).status).toBe(200);
    expect(h.release).toHaveBeenCalledWith({
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "telemetry.event.record" },
      leaseId: "c".repeat(32),
    });
  });

  it("returns a redacted 503 for admission infrastructure failure", async () => {
    h.admit.mockResolvedValueOnce({ admitted: false, code: "control_plane_unavailable" });
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });

    h.admit.mockResolvedValueOnce({ admitted: false, code: "invalid_request" });
    const invalid = await POST(request());
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ ok: false });
  });

  it("uses trusted scope and keeps the content-free limiting response", async () => {
    h.admit.mockResolvedValueOnce({ admitted: false, code: "rate_limited" });
    const response = await POST(request(event, { "x-real-ip": "caller-controlled" }));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(h.admit).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "telemetry.event.record" },
    }), expect.objectContaining({ maxRequests: 60, maxSizeBytes: 4096 }));
    expect(h.log).not.toHaveBeenCalled();
  });

  it("keeps validation, authentication, tenant resolution, success and redaction boundaries", async () => {
    expect((await POST(new Request("https://app.example.test/api/telemetry", { method: "POST", body: "{" }))).status).toBe(400);
    h.tenant.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(404);
    h.session.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(200);
    const success = await POST(request());
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({ ok: true });
  });

  it("logs only a fixed event and outcome for validated telemetry", async () => {
    const pageEvent = JSON.stringify({
      name: "sample.page.viewed",
      tenantId: "caller_tenant",
      moduleKey: "sample",
      moduleVersion: "1.0.0",
      occurredAt: "2026-08-06T12:00:00.000Z",
      properties: {},
    });
    expect((await POST(request(pageEvent))).status).toBe(200);

    const exportEvent = JSON.stringify({
      name: "sample.export.completed",
      tenantId: "caller_tenant",
      moduleKey: "sample",
      moduleVersion: "1.0.0",
      occurredAt: "2026-08-06T12:00:00.000Z",
      properties: { format: "json", respondentCount: 2 },
    });
    expect((await POST(request(exportEvent))).status).toBe(200);

    expect(h.log).toHaveBeenCalledTimes(2);
    expect(h.log.mock.calls).toEqual([
      [{ event: "telemetry.accepted", outcome: "ok" }],
      [{ event: "telemetry.accepted", outcome: "ok" }],
    ]);
  });

  it("rejects invalid shape without invoking tenant or admission work", async () => {
    const invalid = JSON.stringify({
      name: "sample.page.viewed",
      tenantId: "caller_tenant",
      moduleKey: "sample",
      moduleVersion: "1.0.0",
      occurredAt: "2026-08-06T12:00:00.000Z",
      properties: {},
      prompt: "private content",
    });

    const response = await POST(request(invalid));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: "invalid event shape" });
    expect(h.tenant).not.toHaveBeenCalled();
    expect(h.admit).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });

  it("returns the same redacted shape for size and fingerprint conflict denial", async () => {
    h.admit.mockResolvedValueOnce({ admitted: false, code: "size_exceeded" });
    await expect((await POST(request())).json()).resolves.toEqual({ ok: false });
    h.admit.mockResolvedValueOnce({ admitted: false, code: "idempotency_conflict" });
    const conflict = await POST(request(event, { "idempotency-key": "same-key" }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ ok: false });
  });
});
