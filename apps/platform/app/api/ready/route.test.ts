import { afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn().mockResolvedValue(undefined), config: vi.fn() }));
vi.mock("pg", () => ({ Client: class {
  constructor(config: unknown) { db.config(config); }
  connect = db.connect; query = db.query; end = db.end;
} }));
import { GET } from "./route";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("readiness", () => {
  it("queries the control plane with bounded connect and statement timeouts", async () => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://db.example.test/control");
    expect((await GET()).status).toBe(200);
    expect(db.query).toHaveBeenCalledWith("select 1");
    expect(db.config).toHaveBeenCalledWith(expect.objectContaining({ connectionTimeoutMillis: 750, query_timeout: 750, statement_timeout: 750 }));
    expect(db.end).toHaveBeenCalledOnce();
  });
  it.each(["connect", "query"] as const)("returns a secret-free uncached 503 on %s failure", async (step) => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "postgresql://db.example.test/control");
    db[step].mockRejectedValueOnce(new Error("credential-secret connection details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(db.end).toHaveBeenCalledOnce();
  });
  it("returns 503 when the database is unconfigured", async () => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", "");
    expect((await GET()).status).toBe(503);
    expect(db.config).not.toHaveBeenCalled();
  });
});
