import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fresh-import tests re-evaluate the module graph; allow for loaded CI hosts.
const MODULE_RELOAD_TIMEOUT_MS = 30_000;

const mocks = vi.hoisted(() => ({
  attachDatabasePool: vi.fn(),
  clients: [] as Array<{
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  }>,
  poolOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@vercel/functions", () => ({
  attachDatabasePool: mocks.attachDatabasePool,
}));

vi.mock("pg", () => ({
  Pool: class {
    readonly client = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };

    constructor(options: Record<string, unknown>) {
      mocks.poolOptions.push(options);
      mocks.clients.push(this.client);
    }

    connect = vi.fn(async () => this.client);
    query = vi.fn(async () => ({ rows: [] }));
  },
}));

describe("control-plane database access", () => {
  beforeEach(() => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://localhost/opentenant");
    delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for("opentenant.control-plane-pool")];
    mocks.attachDatabasePool.mockReset();
    mocks.clients.length = 0;
    mocks.poolOptions.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reuses one observable bounded pool across module reloads", async () => {
    const firstModule = await import("./control-plane");
    const firstPool = firstModule.controlPlanePool();
    vi.resetModules();
    const secondModule = await import("./control-plane");

    expect(secondModule.controlPlanePool()).toBe(firstPool);
    expect(mocks.poolOptions).toEqual([{
      connectionString: "postgresql://localhost/opentenant",
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
    }]);
    expect(mocks.attachDatabasePool).toHaveBeenCalledTimes(1);
    expect(mocks.attachDatabasePool).toHaveBeenCalledWith(firstPool);
  }, MODULE_RELOAD_TIMEOUT_MS);

  it("runs begin, work, and commit on the same checked-out client", async () => {
    const { withControlPlaneTransaction } = await import("./control-plane");
    const result = await withControlPlaneTransaction(async (client) => {
      await client.query("domain write");
      return "done";
    });

    expect(result).toBe("done");
    expect(mocks.clients[0]?.query.mock.calls.map(([sql]) => sql)).toEqual([
      "begin",
      "domain write",
      "commit",
    ]);
    expect(mocks.clients[0]?.release).toHaveBeenCalledWith();
  });

  it("rolls back, propagates the work error, and releases a healthy client", async () => {
    const failure = new Error("audit append failed");
    const { withControlPlaneTransaction } = await import("./control-plane");

    await expect(withControlPlaneTransaction(async () => {
      throw failure;
    })).rejects.toBe(failure);

    expect(mocks.clients[0]?.query.mock.calls.map(([sql]) => sql)).toEqual(["begin", "rollback"]);
    expect(mocks.clients[0]?.release).toHaveBeenCalledWith();
  });

  it("marks a commit failure as outcome-unknown after attempting rollback", async () => {
    const commitFailure = new Error("connection lost during commit");
    const { ControlPlaneCommitError, withControlPlaneTransaction } = await import("./control-plane");

    const operation = withControlPlaneTransaction(async (client) => {
      (client.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
        if (sql === "commit") throw commitFailure;
        return { rows: [] };
      });
    });

    await expect(operation).rejects.toEqual(
      expect.objectContaining({
        name: "ControlPlaneCommitError",
        cause: commitFailure,
      }),
    );
    await expect(operation).rejects.toBeInstanceOf(ControlPlaneCommitError);
    expect(mocks.clients.at(-1)?.query.mock.calls.map(([sql]) => sql)).toEqual([
      "begin",
      "commit",
      "rollback",
    ]);
    expect(mocks.clients.at(-1)?.release).toHaveBeenCalledWith();
  });

  it("destroys the checked-out client when rollback itself fails", async () => {
    const workFailure = new Error("domain write failed");
    const rollbackFailure = new Error("connection lost during rollback");
    const { withControlPlaneTransaction } = await import("./control-plane");

    const operation = withControlPlaneTransaction(async (client) => {
      (client.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
        if (sql === "rollback") throw rollbackFailure;
        return { rows: [] };
      });
      throw workFailure;
    });

    await expect(operation).rejects.toBe(workFailure);
    expect(mocks.clients.at(-1)?.release).toHaveBeenCalledWith(rollbackFailure);
  });
});
