import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PgTenantResolver } from "./tenant-resolver";

function poolReturning(rows: unknown[] = []) {
  const query = vi.fn(async () => ({ rows }));
  return { pool: { query } as unknown as Pool, query };
}

describe("PgTenantResolver cache", () => {
  it("serves repeated lookups from cache, including misses", async () => {
    const { pool, query } = poolReturning();
    const resolver = new PgTenantResolver(pool);

    await expect(resolver.tenantForHost("unknown.example.test")).resolves.toBeNull();
    await expect(resolver.tenantForHost("unknown.example.test")).resolves.toBeNull();

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("stays bounded under a flood of distinct unknown hosts", async () => {
    const { pool } = poolReturning();
    const resolver = new PgTenantResolver(pool);

    for (let index = 0; index < 6_000; index += 1) {
      await resolver.tenantForHost(`probe-${index}.example.test`);
    }

    const cache = (resolver as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBeLessThanOrEqual(5_000);
    expect(cache.has("probe-0.example.test")).toBe(false);
    expect(cache.has("probe-5999.example.test")).toBe(true);
  });
});
