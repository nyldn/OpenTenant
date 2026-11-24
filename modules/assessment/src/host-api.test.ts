import { ModelResolutionError } from "@opentenant/platform-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  admit: vi.fn(),
  release: vi.fn(),
  access: vi.fn(),
  cookies: vi.fn(),
  prepare: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("./readout", () => ({ createAssessmentReadout: () => ({ prepare: dependencies.prepare }) }));
import { createReadoutApi } from "./host-api";
import type { ModuleHostServices } from "@opentenant/database/module-host";
const POST = createReadoutApi({
  admitPlatformRequest: dependencies.admit, releasePlatformAdmission: dependencies.release,
  resolveModuleAccess: (_key: string, cookie: string | undefined) => dependencies.access(cookie),
  cookies: dependencies.cookies, accessCookieName: () => "module-cookie", modelRouter: () => ({}),
  sameOrigin: (request: Request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin,
} as unknown as ModuleHostServices);

const summary = "A synthetic assessment summary";
const policy = {
  provider: "synthetic",
  model: "assessment-local",
  region: "eu",
  retentionPosture: "zero_retention",
  allowlistVersion: "allowlist-v1",
  source: "tenant_module_use_case",
} as const;
const freshLease = {
  leaseId: "a".repeat(32),
  scope: {
    tenantId: "tenant_alpha",
    principalId: "user_alpha",
    operation: "assessment.readout.generate",
  },
  admittedAtMs: 0,
  expiresAtMs: Number.MAX_SAFE_INTEGER,
  policy: {
    maxRequests: 20,
    windowMs: 60_000,
    maxConcurrent: 20,
    leaseMs: 30_000,
    idempotencyTtlMs: 60_000,
    maxIdempotencyEntriesPerScope: 100,
    maxSizeBytes: 32 * 1024,
  },
};

function request(body: unknown = { summary }, idempotencyKey?: string): Request {
  return new Request("https://app.example.test/api/assessment-readout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function prepared(fingerprint = "resolved-policy-v1", stream = dependencies.stream) {
  return { fingerprint, policy, stream };
}

describe("assessment readout route", () => {
  dependencies.access.mockResolvedValue({
    ok: true,
    tenantId: "tenant_alpha",
    mode: "identity",
    principal: { kind: "identity", principalId: "user_alpha", session: {} },
  });
  dependencies.cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
  dependencies.prepare.mockResolvedValue(prepared());
  dependencies.stream.mockImplementation(async function* () {
    yield { type: "content", content: "First " };
    yield { type: "content", content: "step" };
    yield { type: "completed" };
  });
  dependencies.admit.mockResolvedValue({ admitted: true, replayed: false, lease: freshLease });
  dependencies.release.mockResolvedValue({ status: "released" });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    dependencies.access.mockResolvedValue({
      ok: true,
      tenantId: "tenant_alpha",
      mode: "identity",
      principal: { kind: "identity", principalId: "user_alpha", session: {} },
    });
    dependencies.cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
    dependencies.prepare.mockResolvedValue(prepared());
    dependencies.stream.mockImplementation(async function* () {
      yield { type: "content", content: "First " };
      yield { type: "content", content: "step" };
      yield { type: "completed" };
    });
    dependencies.admit.mockResolvedValue({ admitted: true, replayed: false, lease: freshLease });
    dependencies.release.mockResolvedValue({ status: "released" });
  });

  it.each([
    [{ ok: false, reason: "anonymous", tenantId: "tenant_alpha", mode: "identity" }, 401],
    [{ ok: false, reason: "passcode_required", tenantId: "tenant_alpha", mode: "passcode" }, 401],
    [{ ok: false, reason: "forbidden", tenantId: "tenant_alpha", mode: "identity" }, 403],
    [{ ok: false, reason: "unavailable", tenantId: "tenant_alpha" }, 404],
    [{ ok: false, reason: "no_tenant" }, 404],
  ])("maps an Assessment access denial to no-store before policy or admission", async (access, status) => {
    dependencies.access.mockResolvedValueOnce(access);

    const response = await POST(request());

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.prepare).not.toHaveBeenCalled();
    expect(dependencies.admit).not.toHaveBeenCalled();
  });

  it("uses the signed passcode principal for policy and admission", async () => {
    const principal = {
      kind: "passcode",
      principalId: "passcode:assessment",
      tenantId: "tenant_alpha",
      moduleKey: "assessment",
    } as const;
    dependencies.cookies.mockResolvedValueOnce({ get: vi.fn(() => ({ value: "signed-grant" })) });
    dependencies.access.mockResolvedValueOnce({
      ok: true,
      tenantId: "tenant_alpha",
      mode: "passcode",
      principal,
    });
    dependencies.admit.mockResolvedValueOnce({ admitted: false, code: "rate_limited" });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(dependencies.access).toHaveBeenCalledExactlyOnceWith("signed-grant");
    expect(dependencies.prepare).toHaveBeenCalledExactlyOnceWith({ tenantId: "tenant_alpha", principal, summary });
    expect(dependencies.admit).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        tenantId: "tenant_alpha",
        principalId: "passcode:assessment",
        operation: "assessment.readout.generate",
      },
    }), expect.anything());
  });

  it.each([
    ["not-json", "not-json"],
    ["null", "null"],
    ["array", "[]"],
    ["numeric summary", JSON.stringify({ summary: 42 })],
    ["numeric provider hint", JSON.stringify({ summary: "valid", provider: 42 })],
    ["object model hint", JSON.stringify({ summary: "valid", model: {} })],
  ])("rejects malformed %s input before policy or admission", async (_case, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.prepare).not.toHaveBeenCalled();
    expect(dependencies.admit).not.toHaveBeenCalled();
  });

  it("bounds summary characters and actual request bytes", async () => {
    const tooManyCharacters = await POST(request({ summary: "s".repeat(6_001) }));
    expect(tooManyCharacters.status).toBe(413);
    expect(await tooManyCharacters.text()).toBe("request too large");

    const highByteSummary = "😀".repeat(6_000);
    const accepted = await POST(request({ summary: highByteSummary }));
    expect(accepted.status).toBe(200);
    await accepted.text();
    expect(dependencies.prepare).toHaveBeenCalledWith(expect.objectContaining({ summary: highByteSummary }));

    dependencies.prepare.mockClear();
    const overTransportLimit = new Request("https://app.example.test/api/assessment-readout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.test" },
      body: JSON.stringify({ summary: "s".repeat(32 * 1024) }),
    });
    expect(overTransportLimit.headers.get("content-length")).toBeNull();
    const tooManyBytes = await POST(overTransportLimit);
    expect(tooManyBytes.status).toBe(413);
    expect(dependencies.prepare).not.toHaveBeenCalled();
  });

  it("rejects cross-scheme and malformed origins before tenant work", async () => {
    for (const origin of ["http://app.example.test", "not an origin"]) {
      const denied = request();
      denied.headers.set("origin", origin);
      const response = await POST(denied);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(dependencies.cookies).not.toHaveBeenCalled();
    expect(dependencies.access).not.toHaveBeenCalled();
    expect(dependencies.prepare).not.toHaveBeenCalled();
  });

  it("returns safe unavailability when accepted model policy cannot resolve", async () => {
    dependencies.prepare.mockRejectedValueOnce(
      new ModelResolutionError("UNRESOLVABLE_SLOT", "internal model policy detail"),
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("model unavailable");
    expect(dependencies.admit).not.toHaveBeenCalled();
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("uses resolved policy in admission while client model hints carry no authority", async () => {
    dependencies.admit.mockResolvedValue({ admitted: false, code: "rate_limited" });

    await POST(request({ summary, provider: "caller-provider", model: "caller-model" }));
    await POST(request({ summary, provider: "another-provider", model: "another-model" }));

    expect(dependencies.prepare).toHaveBeenNthCalledWith(1, {
      tenantId: "tenant_alpha",
      principal: expect.objectContaining({ principalId: "user_alpha" }),
      summary,
    });
    expect(dependencies.prepare).toHaveBeenNthCalledWith(2, {
      tenantId: "tenant_alpha",
      principal: expect.objectContaining({ principalId: "user_alpha" }),
      summary,
    });
    const requests = dependencies.admit.mock.calls.map(([admissionRequest]) => admissionRequest);
    expect(requests.map((admissionRequest) => admissionRequest.fingerprint)).toEqual([
      "resolved-policy-v1",
      "resolved-policy-v1",
    ]);
    expect(dependencies.stream).not.toHaveBeenCalled();
  });

  it("turns a stale resolved policy into an idempotency conflict without replaying inference", async () => {
    const firstStream = vi.fn(async function* () { yield { type: "completed" }; });
    const staleStream = vi.fn(async function* () { yield { type: "completed" }; });
    dependencies.prepare
      .mockResolvedValueOnce(prepared("resolved-policy-v1", firstStream))
      .mockResolvedValueOnce(prepared("resolved-policy-v2", staleStream));
    dependencies.admit
      .mockResolvedValueOnce({ admitted: true, replayed: false, lease: freshLease })
      .mockResolvedValueOnce({ admitted: false, code: "idempotency_conflict" });

    const first = await POST(request({ summary }, "same-attempt"));
    expect(await first.text()).toBe("data: {\"done\":true}\n\n");
    const stale = await POST(request({ summary }, "same-attempt"));

    expect(stale.status).toBe(409);
    expect(await stale.text()).toBe("idempotency conflict");
    expect(firstStream).toHaveBeenCalledOnce();
    expect(staleStream).not.toHaveBeenCalled();
  });

  it("does not execute replayed inference and maps admission failures", async () => {
    dependencies.admit.mockResolvedValueOnce({ admitted: true, replayed: true, lease: freshLease });
    expect((await POST(request())).status).toBe(409);
    expect(dependencies.stream).not.toHaveBeenCalled();
    expect(dependencies.release).not.toHaveBeenCalled();

    dependencies.admit.mockResolvedValueOnce({ admitted: false, code: "control_plane_unavailable" });
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toBe("service unavailable");

    dependencies.admit.mockResolvedValueOnce({ admitted: false, code: "invalid_request" });
    const invalid = await POST(request());
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe("invalid request");
  });

  it("streams SSE deltas and completion through the model router", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe(
      "data: {\"delta\":\"First \"}\n\ndata: {\"delta\":\"step\"}\n\ndata: {\"done\":true}\n\n",
    );
    expect(dependencies.stream).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(dependencies.release).toHaveBeenCalledWith({ scope: freshLease.scope, leaseId: freshLease.leaseId });
  });

  it.each(["ADAPTER_ERROR", "AUDIT_ERROR"])(
    "maps %s terminal failure to one bounded SSE error",
    async (code) => {
      dependencies.stream.mockImplementationOnce(async function* () {
        yield { type: "failed", code };
      });

      const response = await POST(request());

      expect(await response.text()).toBe("data: {\"error\":\"provider request failed\"}\n\n");
      expect(dependencies.release).toHaveBeenCalledOnce();
    },
  );

  it("bounds a policy change after admission and releases the lease", async () => {
    dependencies.stream.mockReturnValueOnce({
      [Symbol.asyncIterator]() { return this; },
      next: vi.fn().mockRejectedValue(
        new ModelResolutionError(
          "PREPARED_POLICY_STALE",
          "prepared model policy is no longer current",
        ),
      ),
      return: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    });

    const response = await POST(request());

    expect(await response.text()).toBe("data: {\"error\":\"provider request failed\"}\n\n");
    expect(dependencies.release).toHaveBeenCalledWith({ scope: freshLease.scope, leaseId: freshLease.leaseId });
  });

  it("aborts model streaming at the persisted lease deadline", async () => {
    vi.useFakeTimers();
    const expiringLease = { ...freshLease, expiresAtMs: Date.now() + 1_000 };
    dependencies.admit.mockResolvedValueOnce({ admitted: true, replayed: false, lease: expiringLease });
    let routerSignal: AbortSignal | undefined;
    dependencies.stream.mockImplementationOnce(async function* (signal: AbortSignal) {
      routerSignal = signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      yield { type: "cancelled" };
    });

    const response = await POST(request());
    const body = response.text();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(routerSignal?.aborted).toBe(true);
    expect(await body).toBe("data: {\"error\":\"provider request failed\"}\n\n");
    expect(dependencies.release).toHaveBeenCalledWith({
      scope: expiringLease.scope,
      leaseId: expiringLease.leaseId,
    });
  });

  it("cancels model streaming and releases the lease when the client disconnects", async () => {
    let routerSignal: AbortSignal | undefined;
    let cleanedUp = false;
    dependencies.stream.mockImplementationOnce(async function* (signal: AbortSignal) {
      routerSignal = signal;
      try {
        yield { type: "content", content: "first" };
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        yield { type: "cancelled" };
      } finally {
        cleanedUp = true;
      }
    });

    const response = await POST(request());
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();

    expect(routerSignal?.aborted).toBe(true);
    expect(cleanedUp).toBe(true);
    expect(dependencies.release).toHaveBeenCalledWith({ scope: freshLease.scope, leaseId: freshLease.leaseId });
  });

  it("uses the Node.js runtime and keeps summary-required validation", async () => {

    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("summary required");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
