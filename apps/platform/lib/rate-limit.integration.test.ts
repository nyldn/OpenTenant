import { integrationDatabaseUrl } from "../../../tooling/migrations/src/integration-guard";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { RateLimiterPostgres } from "rate-limiter-flexible";
import { readdir, readFile } from "node:fs/promises";
import { applyMigrations } from "@opentenant/migrations";
import { closeRateLimitPool, createRateLimitGate, enforceRateLimit } from "./rate-limit";

vi.mock("./tenant", () => ({ tenantLifecycleForHost: async () => null }));
const url = integrationDatabaseUrl("RATE_LIMIT_DATABASE_URL");
const suite = url ? describe : describe.skip;
suite("Postgres rate limit proof", () => {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  beforeAll(async () => {
    const directory = new URL("../../../tooling/migrations/sql/control-plane/", import.meta.url);
    const migrations = await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".sql")).sort().map(async (name) => ({ id: name.slice(0, -4), sql: await readFile(new URL(name, directory), "utf8") })));
    await pool.query("drop schema if exists developer_mcp cascade; drop schema if exists public cascade");
    await pool.query("create schema public");
    await applyMigrations(pool, migrations);
  });
  beforeEach(async () => { await pool.query("delete from request_rate_limits"); });
  afterAll(async () => { vi.unstubAllEnvs(); await closeRateLimitPool(); await pool.end(); });
  it("serializes 40 simultaneous attempts through a one-connection pool with exactly 5 admissions", async () => {
    const limiter = new RateLimiterPostgres({ storeClient: pool, tableName: "request_rate_limits", tableCreated: true, keyPrefix: "race", points: 5, duration: 60 });
    const gate = createRateLimitGate(limiter);
    const responses = await Promise.all(Array.from({ length: 40 }, () => gate({ tenantId: "ten_synthetic", userId: "usr_synthetic", routeClass: "settings" })));
    expect(responses.filter((response) => response === null)).toHaveLength(5);
    expect(responses.filter((response) => response?.status === 429)).toHaveLength(35);
    expect(responses.filter((response) => response?.status === 503)).toHaveLength(0);
    expect(pool.totalCount).toBe(1);
    expect(pool.waitingCount).toBe(0);
    expect((await pool.query("select key from request_rate_limits")).rows.every((row) => !/synthetic/.test(row.key))).toBe(true);
    // New instances see the same persisted budget.
    const second = new RateLimiterPostgres({ storeClient: pool, tableName: "request_rate_limits", tableCreated: true, keyPrefix: "race", points: 5, duration: 60 });
    expect((await createRateLimitGate(second)({ tenantId: "ten_synthetic", userId: "usr_synthetic", routeClass: "settings" }))?.status).toBe(429);
    expect(await createRateLimitGate(second)({ tenantId: "ten_other", userId: "usr_synthetic", routeClass: "settings" })).toBeNull();
    expect(await createRateLimitGate(second)({ tenantId: "ten_synthetic", userId: "usr_other", routeClass: "settings" })).toBeNull();
  });
  it("starts a fresh window after expiry", async () => {
    const limiter = new RateLimiterPostgres({ storeClient: pool, tableName: "request_rate_limits", tableCreated: true, keyPrefix: "expiry", points: 1, duration: 60 });
    const gate = createRateLimitGate(limiter);
    const scope = { tenantId: "ten_synthetic", userId: "usr_expiry", routeClass: "settings" as const };
    expect(await gate(scope)).toBeNull();
    expect((await gate(scope))?.status).toBe(429);
    await pool.query("update request_rate_limits set expire = 0 where key like 'expiry%'");
    expect(await gate(scope)).toBeNull();
  });
  it("limits rotating users on one ingress IP through the production entrypoint", async () => {
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", url!);
    vi.stubEnv("OPENTENANT_TRUSTED_IP_HEADER", "x-ingress-ip");
    const req = new Request("https://example.test/api/module-access/sample", { method: "POST", headers: { "x-ingress-ip": "192.0.2.10" } });
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => enforceRateLimit(req, { tenantId: "ten_ip_synthetic", userId: `usr_${i}`, routeClass: "passcode" })));
    expect({ admitted: responses.filter(response => response === null).length, limited: responses.filter(response => response?.status === 429).length, unavailable: responses.filter(response => response?.status === 503).length }).toEqual({ admitted: 5, limited: 7, unavailable: 0 });
    expect(responses.filter((response) => response?.status === 503)).toHaveLength(0);
    expect(responses.filter((response) => response?.status === 429).every((response) => Number(response!.headers.get("Retry-After")) > 0)).toBe(true);
  });

});
