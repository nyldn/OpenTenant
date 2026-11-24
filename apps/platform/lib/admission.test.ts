import { beforeEach, describe, expect, it, vi } from "vitest";

// Fresh-import tests re-evaluate the module graph; allow for loaded CI hosts.
const MODULE_RELOAD_TIMEOUT_MS = 30_000;

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

const harness = vi.hoisted(() => ({
  stores: [] as Array<{ admit: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>,
  pools: [] as Array<{ options: unknown }>,
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) { harness.pools.push({ options }); }
  },
}));

vi.mock("@opentenant/database", () => ({
  PgAdmissionStore: class {
    admit = vi.fn().mockResolvedValue({ admitted: false, code: "rate_limited" });
    release = vi.fn().mockResolvedValue({ status: "released" });
    constructor() { harness.stores.push(this); }
  },
}));

describe("platform admission composition", () => {
  beforeEach(() => {
    for (const symbol of Object.getOwnPropertySymbols(globalThis)) {
      if (
        symbol.description === "opentenant.platform.admission-store"
        || symbol.description === "opentenant.control-plane-pool"
      ) delete (globalThis as Record<symbol, unknown>)[symbol];
    }
    vi.resetModules();
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://synthetic.invalid/control-plane");
    harness.stores.length = 0;
    harness.pools.length = 0;
  });

  it("keeps one PostgreSQL-backed store across fresh imports and forwards an explicit literal policy", async () => {
    const policy = {
      maxRequests: 2,
      windowMs: 60_000,
      maxConcurrent: 2,
      leaseMs: 1_000,
      idempotencyTtlMs: 60_000,
      maxIdempotencyEntriesPerScope: 20,
      maxSizeBytes: 32,
    } as const;
    const request = {
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "test.operation" },
      idempotencyKey: "request-alpha",
      fingerprint: "a".repeat(64),
      sizeBytes: 12,
    };

    const first = await import("./admission");
    await expect(first.admitPlatformRequest(request, policy)).resolves.toEqual({ admitted: false, code: "rate_limited" });

    await expect(first.releasePlatformAdmission({
      scope: request.scope,
      leaseId: "a".repeat(32),
    })).resolves.toEqual({ status: "released" });

    vi.resetModules();
    const second = await import("./admission");
    await second.admitPlatformRequest(request, policy);

    expect(harness.stores).toHaveLength(1);
    expect(harness.stores[0]!.admit).toHaveBeenNthCalledWith(1, request, policy);
    expect(harness.stores[0]!.admit).toHaveBeenNthCalledWith(2, request, policy);
    expect(harness.stores[0]!.release).toHaveBeenCalledWith({
      scope: request.scope,
      leaseId: "a".repeat(32),
    });
    expect(harness.pools).toEqual([{ options: {
      connectionString: "postgresql://synthetic.invalid/control-plane",
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
    } }]);
  }, MODULE_RELOAD_TIMEOUT_MS);

  it("fails closed when the control-plane database is not configured", async () => {
    vi.unstubAllEnvs();
    const { admitPlatformRequest } = await import("./admission");
    await expect(admitPlatformRequest({
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "test.operation" },
      idempotencyKey: "request-alpha",
      fingerprint: "a".repeat(64),
      sizeBytes: 12,
    }, {
      maxRequests: 1, windowMs: 1, maxConcurrent: 1, leaseMs: 1,
      idempotencyTtlMs: 1, maxIdempotencyEntriesPerScope: 1, maxSizeBytes: 12,
    })).resolves.toEqual({ admitted: false, code: "control_plane_unavailable" });
  });

  it("rejects malformed caller input without misclassifying it as a control-plane outage", async () => {
    const { admitPlatformRequest } = await import("./admission");
    await expect(admitPlatformRequest({
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "test.operation" },
      idempotencyKey: " malformed-key", fingerprint: "a".repeat(64), sizeBytes: 12,
    }, {
      maxRequests: 1, windowMs: 1, maxConcurrent: 1, leaseMs: 1,
      idempotencyTtlMs: 1, maxIdempotencyEntriesPerScope: 1, maxSizeBytes: 12,
    })).resolves.toEqual({ admitted: false, code: "invalid_request" });
    expect(harness.stores).toHaveLength(0);
  });

  it("distinguishes a normalized store failure from customer policy denials", async () => {
    const { admitPlatformRequest } = await import("./admission");
    const request = {
      scope: { tenantId: "tenant_alpha", principalId: "user_alpha", operation: "test.operation" },
      idempotencyKey: "request-alpha", fingerprint: "a".repeat(64), sizeBytes: 12,
    };
    const policy = { maxRequests: 1, windowMs: 1, maxConcurrent: 1, leaseMs: 1, idempotencyTtlMs: 1, maxIdempotencyEntriesPerScope: 1, maxSizeBytes: 12 };
    await admitPlatformRequest(request, policy);
    harness.stores[0]!.admit.mockResolvedValueOnce({ admitted: false, code: "invalid_request" });
    await expect(admitPlatformRequest(request, policy)).resolves.toEqual({ admitted: false, code: "control_plane_unavailable" });

    harness.stores[0]!.admit.mockResolvedValueOnce({ admitted: false, code: "concurrency_limited" });
    await expect(admitPlatformRequest(request, policy)).resolves.toEqual({ admitted: false, code: "concurrency_limited" });
  });
});
